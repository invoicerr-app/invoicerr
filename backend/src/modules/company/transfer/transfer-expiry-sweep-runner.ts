/**
 * The Prisma-touching half of the transfer-expiry sweep — walks every PENDING transfer whose window
 * has lapsed and moves it to EXPIRED, one row at a time through `expire-transfer.ts#expireOwnershipTransfer`
 * (the SAME function `transfer.service.ts#acceptTransfer`'s own lazy path uses), so there is exactly
 * one place deciding what "expired" means and one place sending the notice. Registered as the one
 * repeatable job on `queue/transfer-queue.constants.ts`'s own queue, consumed by
 * `queue/transfer-expiry.processor.ts` — see that constants file's own header for why this feature
 * gets its own queue rather than joining the documents module's.
 */
import { Injectable, Logger } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';

import { expireOwnershipTransfer } from './expire-transfer';

export interface RunTransferExpirySweepResult {
  /** How many PENDING, past-window transfers this pass looked at. */
  candidates: number;
  /** How many this pass actually flipped to EXPIRED — see `expireOwnershipTransfer`'s own header on
   *  why this can be lower than `candidates` (a concurrent accept/cancel already moved a row on). */
  expired: number;
}

@Injectable()
export class TransferExpirySweepRunner {
  private readonly logger = new Logger(TransferExpirySweepRunner.name);

  constructor(private readonly mailService: MailService) {}

  async runSweep(now: Date = new Date()): Promise<RunTransferExpirySweepResult> {
    const candidates = await prisma.companyOwnershipTransfer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true, companyId: true, fromUserId: true, toEmail: true },
    });

    let expired = 0;
    for (const candidate of candidates) {
      try {
        if (await expireOwnershipTransfer(candidate, this.mailService)) expired++;
      } catch (error) {
        // One row's own failure (a DB hiccup mid-write) must never sink the rest of this pass — same
        // "one bad row must not sink the whole pass" discipline every other sweep in this codebase
        // already holds (`billing-lifecycle-sweep-runner.ts`, `currency-rate-sweep-runner.ts`, ...).
        // Left PENDING; the next tick simply finds it again.
        this.logger.error(`Failed to expire ownership transfer ${candidate.id} — retried next tick`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(
      `Ownership transfer expiry sweep: ${candidates.length} candidate(s), ${expired} expired.`,
    );
    return { candidates: candidates.length, expired };
  }
}

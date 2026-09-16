/**
 * The Prisma/mail-touching half of the billing lifecycle sweep — `lifecycle.ts` holds the pure
 * transition decision; this class applies it, the same "pure core, thin persistence shell" split
 * `currency-rate-sweep-runner.ts`/`conformity-sweep-runner.ts` already hold for their own sweeps.
 *
 * Registered as the ONE repeatable job on `billing.module.ts`'s own queue (`queue/billing-queue.constants.ts`,
 * consumed by `queue/billing-lifecycle.processor.ts`) — see `billing-queue.constants.ts`'s own header
 * for why billing gets its OWN queue rather than joining `Q_DOCUMENT_ACTION` (the documents module's
 * queue, always present regardless of the billing flag).
 */
import { Injectable, Logger } from '@nestjs/common';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { BillingExportService } from './export-zip.service';
import { computeLifecycleTransition } from './lifecycle';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { deleteCompanyPermanently } from './deletion';
import { reconcileCompanySeats } from './seat-reconcile';
import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';

export interface RunBillingLifecycleSweepResult {
  processed: number;
  blocked: number;
  zipped: number;
  /** Incremented only when the zip transition's OWN mail send failed — the subscription is left
   *  untouched (still `BLOCKED`) for the next tick to retry, exactly like `currency-rate-sweep-runner`
   *  leaves a pair `skipped` rather than guessing. */
  zipFailed: number;
  deleted: number;
  /** Incremented once per ACTIVE, subscribed company whose seat count had actually drifted from
   *  Polar's own subscription and was just corrected — see `seat-reconcile.ts`'s own header. Zero on
   *  a tick where every count already matched, which is the overwhelming common case. */
  seatsReconciled: number;
}

@Injectable()
export class BillingLifecycleSweepRunner {
  private readonly logger = new Logger(BillingLifecycleSweepRunner.name);

  constructor(
    private readonly exportService: BillingExportService,
    private readonly mailService: MailService,
  ) {}

  /** One sweep pass — never throws for a SINGLE subscription's failure (a mail-send hiccup, a
   *  transiently unreachable DB row); only a fatal error reading the initial list propagates, the
   *  same "one bad row must not sink the whole pass" discipline every other sweep in this codebase
   *  already holds. */
  async runSweep(now: Date = new Date()): Promise<RunBillingLifecycleSweepResult> {
    const subscriptions = await listAdvanceableCompanySubscriptions();
    const result: RunBillingLifecycleSweepResult = {
      processed: subscriptions.length,
      blocked: 0,
      zipped: 0,
      zipFailed: 0,
      deleted: 0,
      seatsReconciled: 0,
    };

    for (const sub of subscriptions) {
      try {
        await this.applyOne(sub, now, result);
      } catch (error) {
        this.logger.error(
          `Billing lifecycle sweep failed for company ${sub.companyId} — left untouched, retried next tick`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }

      // A separate try/catch, deliberately: a failure here must never re-run (or skip) the status
      // transition above for the SAME company, and vice versa — the two are independent concerns
      // sharing only the subscription row read at the top of this loop.
      if (sub.status === 'ACTIVE') {
        try {
          const reconciled = await reconcileCompanySeats(sub);
          if (reconciled?.corrected) result.seatsReconciled++;
        } catch (error) {
          this.logger.error(
            `Seat reconciliation failed for company ${sub.companyId} — left untouched, retried next tick`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      }
    }

    this.logger.log(
      `Billing lifecycle sweep: ${result.processed} subscription(s) looked at, ` +
        `${result.blocked} newly blocked, ${result.zipped} zipped (${result.zipFailed} zip send ` +
        `failures, retried next tick), ${result.deleted} deleted, ${result.seatsReconciled} seat ` +
        'count(s) corrected against Polar.',
    );

    return result;
  }

  private async applyOne(
    sub: CompanySubscription,
    now: Date,
    result: RunBillingLifecycleSweepResult,
  ): Promise<void> {
    const action = computeLifecycleTransition(sub, now);

    switch (action.type) {
      case 'none':
        return;

      case 'enter_blocked':
        await prisma.companySubscription.update({
          where: { companyId: sub.companyId },
          data: { status: 'BLOCKED', blockedAt: action.blockedAt },
        });
        result.blocked++;
        return;

      case 'send_zip_and_enter_zipped': {
        const sent = await this.sendZipToOwner(sub.companyId);
        if (!sent) {
          // Left in BLOCKED, deliberately — the OWNER must actually receive their data before this
          // company's status advances any further toward deletion. The next sweep tick retries the
          // exact same `send_zip_and_enter_zipped` decision (blockedAt is untouched, so
          // `lifecycle.ts` computes the identical action again).
          result.zipFailed++;
          return;
        }
        await prisma.companySubscription.update({
          where: { companyId: sub.companyId },
          data: { status: 'ZIPPED', zipSentAt: action.zipSentAt, deletionDueAt: action.deletionDueAt },
        });
        result.zipped++;
        return;
      }

      case 'delete_company':
        await deleteCompanyPermanently(sub.companyId);
        result.deleted++;
        return;
    }
  }

  /** Builds the export and mails it to the company's OLDEST `OWNER` membership (deterministic when a
   *  company has more than one owner — "the OWNER" in the singular, per the product brief). Returns
   *  `false` (never throws) when no owner exists at all (should not normally happen — every company
   *  has at least one, `assertNotLastOwner`) or the mail send itself failed (e.g. `sendForCompany`'s
   *  own named refusal when neither the company nor the instance has a configured mail server). */
  private async sendZipToOwner(companyId: string): Promise<boolean> {
    const ownerMembership = await prisma.userCompany.findFirst({
      where: { companyId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });

    if (!ownerMembership) {
      this.logger.error(`Company ${companyId} has no OWNER membership — cannot send its data export`);
      return false;
    }

    try {
      const zip = await this.exportService.buildCompanyZip(companyId);
      await this.mailService.sendForCompany(companyId, {
        to: ownerMembership.user.email,
        subject: 'Your company data export',
        text:
          'Your Invoicerr subscription has been blocked for 14 days. Attached is a full export of ' +
          "your company's documents. If you do not act, this data will be permanently deleted.",
        attachments: [{ filename: 'invoicerr-export.zip', content: zip, contentType: 'application/zip' }],
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send the data export to company ${companyId}'s OWNER`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

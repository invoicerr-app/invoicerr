/**
 * Company ownership transfer (product decision 2026-09-17) — an OWNER hands the OWNER role to another
 * user's account; the recipient must explicitly accept before anything changes. See this module's
 * `transfer.module.ts` header for the full shape (controllers, sweep, mail).
 *
 * ## Anti-enumeration, by construction
 * `initiateTransfer` returns the SAME `{ message }` whether or not `toEmail` resolves to an existing
 * account, and — this is the part a response shape alone can't fake — creates NO row at all when it
 * doesn't. The two branches still diverge in local work after that (one extra company lookup and one
 * row insert on the "exists" branch) — negligible against a local Postgres — but the one difference
 * that would actually be WORTH timing (a real network round-trip to the mail provider, only ever on
 * the "exists" branch) is closed by never awaiting that send before responding — see the `void
 * this.mailService.sendForCompany(...)` below.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { MailService } from '@/mail/mail.service';
import {
  buildOwnershipTransferFinalizedEmail,
  buildOwnershipTransferEndedEmail,
  buildOwnershipTransferRequestEmail,
} from '@/mail/system-email-templates';
import { isBillingEnabled } from '@/modules/billing/billing-flag';
import { getOrCreateCompanySubscription } from '@/modules/billing/company-subscription.store';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';

import { CompanyOwnershipTransfer, CompanyRole, Prisma } from '../../../../prisma/generated/prisma/client';
import { verifyAndConsumeDangerOtp } from './danger-otp-check';
import { expireOwnershipTransfer } from './expire-transfer';

/** 7 days, per the product brief — never configurable per company: a transfer either gets answered in
 *  that window or it lapses, same as the danger-zone OTP's own fixed window is not per-company. */
export const TRANSFER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Surfaced only when hosted billing is enabled AND the company's subscription is not in good
 *  standing — see `write-gate.ts#COMPANY_BLOCKED` for the broader (BLOCKED/ZIPPED, every write)
 *  sibling this narrows further to also cover PAST_DUE, which that global guard deliberately leaves
 *  writable. Self-hosted (billing disabled) never sees this code — there is no subscription to be
 *  blocked or unpaid on. */
export const OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED = 'OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED';

function appUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

export interface OwnershipTransferView {
  id: string;
  companyId: string;
  companyName: string;
  status: CompanyOwnershipTransfer['status'];
  toEmail: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  canceledAt: Date | null;
}

@Injectable()
export class TransferService {
  constructor(private readonly mailService: MailService) {}

  /**
   * Refuses (403, `OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED`) once this company's subscription is
   * `BLOCKED`, `PAST_DUE`, or `ZIPPED` — a no-op entirely outside hosted-billing mode, mirroring every
   * other billing gate in this codebase (`send-gate.ts#assertCanSend`, `write-gate.ts#assertCompanyWritable`).
   */
  private async assertCanInitiate(companyId: string): Promise<void> {
    if (!isBillingEnabled()) return;
    const sub = await getOrCreateCompanySubscription(companyId);
    if (sub.status === 'ACTIVE' || sub.status === 'TRIAL') return;

    throw new ForbiddenException({
      message:
        'This company\'s subscription is not active (status "' +
        sub.status +
        '") — an ownership transfer cannot be started until it is regularized. See Settings > Subscription.',
      code: OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED,
    });
  }

  /**
   * `POST /companies/transfer` — OWNER-only, gated by the SAME per-company OTP challenge the danger
   * zone mints. Always resolves to the identical generic message; see this file's own header.
   */
  async initiateTransfer(
    companyId: string,
    fromUser: CurrentUser,
    toEmailRaw: string,
    otp: string,
  ): Promise<{ message: string }> {
    if (!toEmailRaw || typeof toEmailRaw !== 'string' || !otp || typeof otp !== 'string') {
      throw new BadRequestException('email and otp are required');
    }
    const toEmail = toEmailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw new BadRequestException('Invalid email address');
    }

    // OTP first, same order `danger.service.ts#resetApp`/`resetAll` use — no business-logic check
    // below is worth running against a caller who has not actually re-confirmed this OWNER session.
    await verifyAndConsumeDangerOtp(companyId, otp);

    await this.assertCanInitiate(companyId);

    if (toEmail === fromUser.email.trim().toLowerCase()) {
      throw new BadRequestException('You cannot transfer a company to yourself');
    }

    const existingPending = await prisma.companyOwnershipTransfer.findFirst({
      where: { companyId, status: 'PENDING' },
    });
    if (existingPending) {
      throw new ConflictException(
        'This company already has a pending ownership transfer — cancel it before starting a new one.',
      );
    }

    const GENERIC_RESPONSE = {
      message: 'If an account exists for this address, a transfer request has been sent to it.',
    };

    // Case-insensitive: `User.email`'s own storage casing is not something this feature should have to
    // know or normalize — see this file's own header on why this lookup is not itself a timing
    // side-channel worth closing.
    const toUser = await prisma.user.findFirst({
      where: { email: { equals: toEmail, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    if (!toUser) {
      logger.info('Ownership transfer requested for an email with no account — nothing created', {
        category: 'company-transfer',
        companyId,
        details: { userId: fromUser.id },
      });
      return GENERIC_RESPONSE;
    }

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });
    const expiresAt = new Date(Date.now() + TRANSFER_WINDOW_MS);

    try {
      await prisma.companyOwnershipTransfer.create({
        data: {
          companyId,
          fromUserId: fromUser.id,
          toEmail,
          toUserId: toUser.id,
          expiresAt,
        },
      });
    } catch (error) {
      // The partial unique index (`company_ownership_transfer_one_pending_per_company`, this
      // migration's own hand-appended SQL) is the real backstop against two concurrent initiations —
      // the `findFirst` above is only the friendly, common-case pre-check.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'This company already has a pending ownership transfer — cancel it before starting a new one.',
        );
      }
      throw error;
    }

    const email = buildOwnershipTransferRequestEmail({
      appUrl: appUrl(),
      companyName: company.name,
      fromName: `${fromUser.firstname} ${fromUser.lastname}`.trim() || fromUser.email,
    });
    // Never awaited, deliberately: this file's own header promises the SAME response, in the SAME
    // approximate time, whether or not `toEmail` resolves to an account — a real network round-trip to
    // the mail provider on ONLY this (account-exists) branch would reopen exactly the timing side
    // channel that promise exists to close, no matter how identical the two response BODIES are. The
    // row is already committed above, so a send failure here has nothing left to roll back — logged
    // for an operator to notice and, if needed, resend by hand, the same "the state change is the
    // source of truth" posture `billing-lifecycle-sweep-runner.ts` holds for every notice that isn't
    // itself irreplaceable data.
    void this.mailService
      .sendForCompany(companyId, {
        to: toUser.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      })
      .catch((error) => {
        logger.warn('Ownership transfer request mail failed to send', {
          category: 'company-transfer',
          companyId,
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      });

    logger.info('Ownership transfer initiated', {
      category: 'company-transfer',
      companyId,
      details: { userId: fromUser.id, toUserId: toUser.id },
    });

    return GENERIC_RESPONSE;
  }

  /** `GET /companies/transfer` — the active company's current PENDING transfer, or `null`. */
  async getCurrentTransfer(companyId: string): Promise<OwnershipTransferView | null> {
    const transfer = await prisma.companyOwnershipTransfer.findFirst({
      where: { companyId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { name: true } },
        fromUser: { select: { firstname: true, lastname: true, email: true } },
      },
    });
    return transfer ? toView(transfer) : null;
  }

  /** `DELETE /companies/transfer/:id` — OWNER-only, no OTP (a lower-stakes, reversible action: the
   *  OWNER can simply start again). Notifies itself — see `buildOwnershipTransferEndedEmail`'s own
   *  header for why that is a deliberate receipt, not an oversight. */
  async cancelTransfer(companyId: string, transferId: string): Promise<{ success: true }> {
    const transfer = await prisma.companyOwnershipTransfer.findFirst({
      where: { id: transferId, companyId, status: 'PENDING' },
    });
    if (!transfer) {
      throw new NotFoundException('Pending transfer not found');
    }

    const { count } = await prisma.companyOwnershipTransfer.updateMany({
      where: { id: transferId, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    if (count === 0) {
      // Already moved on (accepted/expired) between the read above and this write — nothing left to
      // cancel; same "the concurrent write already decided" posture `expireOwnershipTransfer` holds.
      throw new ConflictException('This transfer request is no longer pending');
    }

    try {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
      const fromUser = await prisma.user.findUnique({
        where: { id: transfer.fromUserId },
        select: { email: true },
      });
      if (company && fromUser) {
        const email = buildOwnershipTransferEndedEmail({
          appUrl: appUrl(),
          companyName: company.name,
          toEmail: transfer.toEmail,
          reason: 'canceled',
        });
        await this.mailService.sendForCompany(companyId, {
          to: fromUser.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      }
    } catch (error) {
      logger.warn('Ownership transfer cancellation mail failed to send', {
        category: 'company-transfer',
        companyId,
        details: { transferId, error: error instanceof Error ? error.message : String(error) },
      });
    }

    logger.info('Ownership transfer canceled', {
      category: 'company-transfer',
      companyId,
      details: { transferId },
    });
    return { success: true };
  }

  /** `GET /account/transfers` — every transfer ever addressed to this user's account, newest first. */
  async listReceivedTransfers(userId: string): Promise<OwnershipTransferView[]> {
    const transfers = await prisma.companyOwnershipTransfer.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { name: true } },
        fromUser: { select: { firstname: true, lastname: true, email: true } },
      },
    });
    return transfers.map(toView);
  }

  /**
   * `POST /account/transfers/:id/accept` — the recipient's own finalize. The legal-acceptance gate
   * (`getPendingAcceptanceSlugs`/`LegalAcceptanceGuard`) is deliberately NOT re-checked here: this
   * route carries no `@LegalGateExempt()`, so the global guard already refuses it first, in hosted
   * mode, exactly the same way it refuses every other write from a caller with a pending re-acceptance
   * — duplicating that check here would only be a second, driftable copy of the same decision.
   */
  async acceptTransfer(transferId: string, userId: string): Promise<{ success: true }> {
    const transfer = await prisma.companyOwnershipTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.toUserId !== userId) {
      throw new NotFoundException('Transfer request not found');
    }

    if (transfer.status !== 'PENDING') {
      throw new ConflictException(`This transfer request is ${transfer.status.toLowerCase()}, not pending`);
    }

    if (transfer.expiresAt.getTime() <= Date.now()) {
      await expireOwnershipTransfer(transfer, this.mailService, appUrl());
      throw new GoneException('This transfer request has expired');
    }

    const claimed = await prisma.$transaction(async (tx) => {
      // The guarded write that actually wins or loses this finalize — see `expireOwnershipTransfer`'s
      // own header on the identical shape: whoever's `updateMany` here matches `status: 'PENDING'` is
      // the one call that gets to run the role changes below; a concurrent cancel/expire racing this
      // same row simply loses the transaction with nothing left to roll back.
      const claim = await tx.companyOwnershipTransfer.updateMany({
        where: { id: transferId, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      if (claim.count === 0) return false;

      await tx.userCompany.upsert({
        where: { userId_companyId: { userId: transfer.toUserId, companyId: transfer.companyId } },
        create: { userId: transfer.toUserId, companyId: transfer.companyId, role: CompanyRole.OWNER },
        update: { role: CompanyRole.OWNER },
      });
      // The FROM user may have left the company entirely since this transfer was initiated (removed by
      // another admin, e.g.) — `updateMany` is a silent no-op in that case rather than throwing, since
      // there is no membership row left to demote.
      await tx.userCompany.updateMany({
        where: { userId: transfer.fromUserId, companyId: transfer.companyId },
        data: { role: CompanyRole.ADMIN },
      });
      return true;
    });

    if (!claimed) {
      throw new ConflictException('This transfer request is no longer pending');
    }

    // Outside the transaction, same placement `invitations.service.ts#useInvitation`/
    // `companies.service.ts#changeMemberRole` already use: a Polar hiccup here must not roll back a
    // role change that already committed. Never throws (see `member-sync.ts`'s own header).
    await syncCompanyMemberOnMembershipChange(transfer.companyId, transfer.toUserId);
    await syncCompanyMemberOnMembershipChange(transfer.companyId, transfer.fromUserId);

    try {
      const company = await prisma.company.findUnique({
        where: { id: transfer.companyId },
        select: { name: true },
      });
      const fromUser = await prisma.user.findUnique({
        where: { id: transfer.fromUserId },
        select: { email: true },
      });
      const toUser = await prisma.user.findUnique({
        where: { id: transfer.toUserId },
        select: { email: true },
      });
      if (company && fromUser && toUser) {
        const forNewOwner = buildOwnershipTransferFinalizedEmail({
          appUrl: appUrl(),
          companyName: company.name,
          forNewOwner: true,
        });
        const forFormerOwner = buildOwnershipTransferFinalizedEmail({
          appUrl: appUrl(),
          companyName: company.name,
          forNewOwner: false,
        });
        await this.mailService.sendForCompany(transfer.companyId, {
          to: toUser.email,
          subject: forNewOwner.subject,
          text: forNewOwner.text,
          html: forNewOwner.html,
        });
        await this.mailService.sendForCompany(transfer.companyId, {
          to: fromUser.email,
          subject: forFormerOwner.subject,
          text: forFormerOwner.text,
          html: forFormerOwner.html,
        });
      }
    } catch (error) {
      logger.warn('Ownership transfer finalize mail failed to send', {
        category: 'company-transfer',
        companyId: transfer.companyId,
        details: { transferId, error: error instanceof Error ? error.message : String(error) },
      });
    }

    logger.info('Ownership transfer accepted', {
      category: 'company-transfer',
      companyId: transfer.companyId,
      details: { transferId, toUserId: transfer.toUserId, fromUserId: transfer.fromUserId },
    });

    return { success: true };
  }
}

type TransferWithRelations = Prisma.CompanyOwnershipTransferGetPayload<{
  include: {
    company: { select: { name: true } };
    fromUser: { select: { firstname: true; lastname: true; email: true } };
  };
}>;

function toView(transfer: TransferWithRelations): OwnershipTransferView {
  return {
    id: transfer.id,
    companyId: transfer.companyId,
    companyName: transfer.company.name,
    status: transfer.status,
    toEmail: transfer.toEmail,
    fromUserId: transfer.fromUserId,
    fromName:
      `${transfer.fromUser.firstname} ${transfer.fromUser.lastname}`.trim() || transfer.fromUser.email,
    fromEmail: transfer.fromUser.email,
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
    acceptedAt: transfer.acceptedAt,
    canceledAt: transfer.canceledAt,
  };
}

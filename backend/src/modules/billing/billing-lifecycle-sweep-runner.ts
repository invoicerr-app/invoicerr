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
import { buildBlockedZipWarningEmail, buildDeletionWarningEmail } from '@/mail/system-email-templates';
import { BillingExportService, ExportZipTimedOutError, ExportZipTooLargeError } from './export-zip.service';
import { computeDueBillingWarnings, computeLifecycleTransition } from './lifecycle';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';
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
  /** Incremented once per company whose Polar CUSTOMER name/email push had failed at write time
   *  (`customer-sync.ts`) and was just retried successfully on this tick. */
  customerSyncRetried: number;
  /** Incremented once per OWNER warning email actually sent this tick (`lifecycle.ts`'s own
   *  `blocked_d7`/`blocked_d1`/`zipped_d7`/`zipped_d1` milestones) — never twice for the same
   *  milestone on the same subscription, see `CompanySubscription.billingWarningMilestonesSent`. */
  warningsSent: number;
  /** This tick's `customer-provisioning.ts#reconcileMissingCompanyCustomers` pass — every company
   *  (not just the ones this sweep otherwise walks, since a company can exist with no
   *  `CompanySubscription` row at all yet) checked for its own Polar customer, one created where
   *  missing. Covers a company created AFTER boot, or whose creation attempt failed earlier (a
   *  transient Polar outage — a duplicate billing email is NOT retried here, see that module's own
   *  header). `undefined` when the pass itself failed outright (never thrown into the rest of the
   *  sweep — see `runSweep`'s own try/catch around this step). */
  customersProvisioned?: number;
  /** This tick's `customer-provisioning.ts#reconcileMissingCompanyCustomers` pass's own `skipped`
   *  count — a company with neither `Company.billingEmail` nor `Company.email` set, so Polar would
   *  refuse the create outright (that module's own header). Distinct from `customersProvisioned`
   *  (created only): surfaced separately so an operator reading the log line can tell "nothing to do"
   *  apart from "some companies are stuck on a data problem only a human can fix (set an email)".
   *  `undefined` when the provisioning pass itself failed outright, same as `customersProvisioned`. */
  customersSkipped?: number;
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
      customerSyncRetried: 0,
      warningsSent: 0,
    };

    // Company-WIDE, deliberately outside the per-subscription loop below: a company created after the
    // last boot (or whose creation attempt failed then, e.g. a transient Polar outage) has no
    // `CompanySubscription` row to be walked by that loop at all yet, but still needs its own Polar
    // customer — `reconcileMissingCompanyCustomers` reads `Company` directly, not this sweep's own
    // subscription list. Own try/catch, same "one failure must never sink the rest of this pass"
    // discipline every step in this method already holds — a Polar outage here must not skip the
    // status transitions, seat reconciliation, or warning mails below.
    try {
      const provisioned = await reconcileMissingCompanyCustomers();
      result.customersProvisioned = provisioned.created;
      result.customersSkipped = provisioned.skipped;
      if (
        provisioned.created > 0 ||
        provisioned.emailTaken > 0 ||
        provisioned.skipped > 0 ||
        provisioned.failed > 0
      ) {
        this.logger.log(
          `Billing customer provisioning: ${provisioned.total} compan${provisioned.total === 1 ? 'y' : 'ies'} ` +
            `checked, ${provisioned.created} created, ${provisioned.emailTaken} refused (billing email ` +
            `taken), ${provisioned.skipped} skipped (no billing email), ${provisioned.failed} failed ` +
            `(retried next tick).`,
        );
      }
    } catch (error) {
      this.logger.error('Polar customer provisioning pass failed outright — retried next tick', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    for (const sub of subscriptions) {
      // Computed from the subscription as read at the TOP of this iteration, deliberately BEFORE
      // `applyOne` below might advance its own status this same tick — see `lifecycle.ts`'s own header
      // on `computeDueBillingWarnings` for why that never coincides with a real milestone in practice
      // (a 7-or-1-day warning fires well inside a window, never at the exact transition boundary).
      try {
        await this.sendDueBillingWarnings(sub, now, result);
      } catch (error) {
        this.logger.error(`Billing warning mail failed for company ${sub.companyId} — retried next tick`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

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

      // Same independence: a company's Polar CUSTOMER push (name/email) is unrelated to its own
      // status transition or seat count — retried here only when the LAST attempt
      // (`customer-sync.ts`, fired inline from `company.service.ts`/`billing-email.ts`) failed.
      if (sub.customerSyncFailedAt) {
        try {
          const retried = await this.retryCustomerSync(sub.companyId);
          if (retried) result.customerSyncRetried++;
        } catch (error) {
          this.logger.error(
            `Polar customer sync retry failed for company ${sub.companyId} — left untouched, retried next tick`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      }
    }

    this.logger.log(
      `Billing lifecycle sweep: ${result.processed} subscription(s) looked at, ` +
        `${result.blocked} newly blocked, ${result.zipped} zipped (${result.zipFailed} zip send ` +
        `failures, retried next tick), ${result.deleted} deleted, ${result.seatsReconciled} seat ` +
        `count(s) corrected against Polar, ${result.customerSyncRetried} customer sync retry(ies), ` +
        `${result.customersProvisioned ?? 0} Polar customer(s) provisioned, ` +
        `${result.warningsSent} OWNER warning mail(s) sent.`,
    );

    return result;
  }

  /**
   * `runSweep` reads its whole worklist in one shot (`listAdvanceableCompanySubscriptions`) and then
   * walks it one company at a time — by the time this loop reaches a company near the end of a large
   * instance's list, `sub` can be tens of seconds (or longer) stale. A webhook landing in that window
   * (the OWNER's card was charged successfully, or a plan change came through the portal) already
   * wrote a NEWER status straight to the row; `applyOne` must never clobber that with a decision made
   * from the snapshot it started with. Every write below is therefore a compare-and-set: the `where`
   * repeats the exact `status`/`lastPolarFactAt` this tick read, so a concurrent write moves the row
   * out from under the match and the `updateMany` simply touches zero rows — this tick's decision is
   * silently dropped rather than applied, and the NEXT tick reads the fresh row and decides again from
   * there. `send_zip_and_enter_zipped` additionally re-reads BEFORE mailing anything: an `updateMany`
   * guard on the WRITE can undo a wrong status, but it cannot un-send an email already in the OWNER's
   * inbox, so that one externally-visible side effect gets its own freshness check first.
   * `delete_company` carries the same idea one step further still — see `deletion.ts`'s own header.
   */
  private async applyOne(
    sub: CompanySubscription,
    now: Date,
    result: RunBillingLifecycleSweepResult,
  ): Promise<void> {
    const action = computeLifecycleTransition(sub, now);

    switch (action.type) {
      case 'none':
        return;

      case 'enter_blocked': {
        const { count } = await prisma.companySubscription.updateMany({
          where: { companyId: sub.companyId, status: sub.status, lastPolarFactAt: sub.lastPolarFactAt },
          data: { status: 'BLOCKED', blockedAt: action.blockedAt },
        });
        // count === 0: a webhook already moved this row past the snapshot this tick read — most
        // commonly the OWNER just paid. Blocking a company that is current on its bill, from a read
        // that is already known to be wrong, would be worse than doing nothing this tick.
        if (count > 0) result.blocked++;
        return;
      }

      case 'send_zip_and_enter_zipped': {
        if (!(await this.matchesCurrentSnapshot(sub))) return;

        const sent = await this.sendZipToOwner(sub.companyId);
        if (!sent) {
          // Left in BLOCKED, deliberately — the OWNER must actually receive their data before this
          // company's status advances any further toward deletion. The next sweep tick retries the
          // exact same `send_zip_and_enter_zipped` decision (blockedAt is untouched, so
          // `lifecycle.ts` computes the identical action again).
          result.zipFailed++;
          return;
        }
        const { count } = await prisma.companySubscription.updateMany({
          where: { companyId: sub.companyId, status: sub.status, lastPolarFactAt: sub.lastPolarFactAt },
          data: { status: 'ZIPPED', zipSentAt: action.zipSentAt, deletionDueAt: action.deletionDueAt },
        });
        if (count > 0) result.zipped++;
        return;
      }

      case 'delete_company': {
        const deleted = await deleteCompanyPermanently(sub.companyId, now);
        if (deleted) result.deleted++;
        return;
      }
    }
  }

  /** Re-reads the row fresh and reports whether it still matches the snapshot `sub` this tick's
   *  decision was computed from — `false` means some other write (a webhook, almost always) already
   *  moved it on, and whatever this tick was about to do next no longer applies. */
  private async matchesCurrentSnapshot(sub: CompanySubscription): Promise<boolean> {
    const fresh = await prisma.companySubscription.findUnique({
      where: { companyId: sub.companyId },
      select: { status: true, lastPolarFactAt: true },
    });
    if (!fresh) return false; // the row vanished entirely (deleted) since this tick's own read
    return fresh.status === sub.status && sameInstant(fresh.lastPolarFactAt, sub.lastPolarFactAt);
  }

  /** Builds the export and mails it to the company's OLDEST `OWNER` membership (deterministic when a
   *  company has more than one owner — "the OWNER" in the singular, per the product brief). Returns
   *  `false` (never throws) when no owner exists at all (should not normally happen — every company
   *  has at least one, `assertNotLastOwner`) or the mail send itself failed (e.g. `sendForCompany`'s
   *  own named refusal when neither the company nor the instance has a configured mail server). */
  private async sendZipToOwner(companyId: string): Promise<boolean> {
    const ownerMembership = await this.findOldestOwnerEmail(companyId);

    if (!ownerMembership) {
      this.logger.error(`Company ${companyId} has no OWNER membership — cannot send its data export`);
      return false;
    }

    try {
      const zip = await this.exportService.buildCompanyZip(companyId);
      await this.mailService.sendForCompany(companyId, {
        to: ownerMembership,
        subject: 'Your company data export',
        text:
          'Your Invoicerr subscription has been blocked for 14 days. Attached is a full export of ' +
          "your company's documents. If you do not act, this data will be permanently deleted.",
        attachments: [{ filename: 'invoicerr-export.zip', content: zip, contentType: 'application/zip' }],
      });
      return true;
    } catch (error) {
      // `ExportZipTooLargeError`/`ExportZipTimedOutError` are named on purpose (`export-zip.service.ts`'s
      // own header): an operator reading this log line can tell "this company's data is too big for an
      // email attachment" apart from a transient mail-server or rendering outage, which is exactly what
      // an opaque `error.message` from a generic failure could not distinguish before. Either way this
      // is still a single company's failure — caught HERE, never propagated past `sendZipToOwner`, so
      // the sweep loop in `runSweep` moves on to the next company regardless of which kind this was.
      const isBoundedFailure =
        error instanceof ExportZipTooLargeError || error instanceof ExportZipTimedOutError;
      this.logger.error(
        isBoundedFailure
          ? `Data export for company ${companyId} exceeded its size/time bound — retried next tick`
          : `Failed to send the data export to company ${companyId}'s OWNER`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }

  /** The company's OLDEST `OWNER` membership's own email — `null` when the company somehow has none
   *  (should not normally happen, `assertNotLastOwner`). Shared by `sendZipToOwner` and
   *  `sendDueBillingWarnings` below — both address the SAME "the OWNER" in the singular. */
  private async findOldestOwnerEmail(companyId: string): Promise<string | null> {
    const ownerMembership = await prisma.userCompany.findFirst({
      where: { companyId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
    return ownerMembership?.user.email ?? null;
  }

  /**
   * Sends any OWNER warning email whose milestone is due (`lifecycle.ts#computeDueBillingWarnings`)
   * and has not already gone out (`sub.billingWarningMilestonesSent`) — through the INSTANCE's own
   * mail provider (`MailService#sendMail`, never `sendForCompany`, see `system-email-templates.ts`'s
   * own header on why). Each milestone is appended to `billingWarningMilestonesSent` right after it is
   * actually sent, one at a time, so a mid-loop failure never marks a milestone sent that never
   * reached anyone; a milestone already in that array is never recomputed as due a second time
   * (`computeDueBillingWarnings` itself has no memory of what was already sent — this is the ONE place
   * that checks).
   */
  private async sendDueBillingWarnings(
    sub: CompanySubscription,
    now: Date,
    result: RunBillingLifecycleSweepResult,
  ): Promise<void> {
    const due = computeDueBillingWarnings(sub, now).filter(
      (milestone) => !sub.billingWarningMilestonesSent.includes(milestone),
    );
    if (due.length === 0) return;

    const ownerEmail = await this.findOldestOwnerEmail(sub.companyId);
    if (!ownerEmail) {
      this.logger.error(`Company ${sub.companyId} has no OWNER membership — cannot send billing warnings`);
      return;
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    for (const milestone of due) {
      const daysRemaining = milestone.endsWith('_d7') ? 7 : 1;
      const email = milestone.startsWith('blocked_')
        ? buildBlockedZipWarningEmail({ appUrl, daysRemaining })
        : buildDeletionWarningEmail({ appUrl, daysRemaining });

      try {
        await this.mailService.sendMail({
          to: ownerEmail,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      } catch (error) {
        this.logger.error(`Billing warning mail (${milestone}) failed for company ${sub.companyId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue; // never marked sent — the next tick retries THIS milestone specifically.
      }

      await prisma.companySubscription.update({
        where: { companyId: sub.companyId },
        data: { billingWarningMilestonesSent: { push: milestone } },
      });
      result.warningsSent++;
    }
  }

  /** Re-reads the company's current name/email/billingEmail and retries the Polar customer push —
   *  `syncPolarCustomerOnCompanyChange` itself already clears `customerSyncFailedAt` on success and
   *  re-stamps it on a repeat failure, so this wrapper only needs to know whether it is WORTH calling
   *  (a company that vanished between the failed push and this tick has nothing left to sync) and
   *  whether the retry actually cleared the flag, to count it accurately. */
  private async retryCustomerSync(companyId: string): Promise<boolean> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true, billingEmail: true },
    });
    if (!company) return false;

    await syncPolarCustomerOnCompanyChange(companyId, company);

    const sub = await prisma.companySubscription.findUnique({
      where: { companyId },
      select: { customerSyncFailedAt: true },
    });
    return sub?.customerSyncFailedAt === null;
  }
}

/** `Date` equality by value, `null`-safe — `lastPolarFactAt` is the compare-and-set anchor `applyOne`
 *  reads alongside `status`, and two `Date` instances holding the same instant are never `===`. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

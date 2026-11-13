/** Applies the pure decisions from `lifecycle.ts`; the single repeatable job on the billing queue. */
import { Injectable, Logger } from '@nestjs/common';

import { runWithCompanyId } from '@/lib/request-context';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { buildBlockedZipWarningEmail, buildDeletionWarningEmail } from '@/mail/system-email-templates';
import { mailT } from '@/mail/i18n';
import { BillingExportService, ExportZipTimedOutError, ExportZipTooLargeError } from './export-zip.service';
import { computeDueBillingWarnings, computeLifecycleTransition } from './lifecycle';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';
import { deleteCompanyPermanently } from './deletion';
import { reconcileCompanySeats } from './seat-reconcile';
import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';
import { appOrigin } from '@/utils/app-origin';

export interface RunBillingLifecycleSweepResult {
  processed: number;
  blocked: number;
  zipped: number;
  /** Zip mail failed; the subscription stays `BLOCKED` for the next tick to retry. */
  zipFailed: number;
  deleted: number;
  seatsReconciled: number;
  customerSyncRetried: number;
  warningsSent: number;
  /** `undefined` when the provisioning pass itself failed. */
  customersProvisioned?: number;
  /** Companies with no email at all, which Polar refuses; these need a human to fix the data. */
  customersSkipped?: number;
}

@Injectable()
export class BillingLifecycleSweepRunner {
  private readonly logger = new Logger(BillingLifecycleSweepRunner.name);

  constructor(
    private readonly exportService: BillingExportService,
    private readonly mailService: MailService,
  ) {}

  /** Never throws for a single subscription's failure; only reading the initial list can fail. */
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

    // Outside the per-subscription loop: new companies may have no subscription row yet but still need
    // a Polar customer. Own try/catch so a Polar outage does not skip the steps below.
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
      // No request context here, and deep `Log` writes need a company scope.
      await runWithCompanyId(sub.companyId, () => this.processOneSubscription(sub, now, result));
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

  private async processOneSubscription(
    sub: CompanySubscription,
    now: Date,
    result: RunBillingLifecycleSweepResult,
  ): Promise<void> {
    // Computed from the snapshot before `applyOne` may advance status this tick.
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

    // Independent try/catch so seat failures and status transitions never affect each other.
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

    // Retried only when the last inline push (`customer-sync.ts`) failed.
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

  /**
   * `sub` may be stale by the time it is processed, so every write is a compare-and-set on the
   * `status`/`lastPolarFactAt` read: a concurrent webhook makes it touch zero rows instead of being
   * clobbered. The zip path also re-reads before mailing, since a sent email cannot be undone.
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
        // count === 0: a webhook moved the row on, most commonly because the owner just paid.
        if (count > 0) result.blocked++;
        return;
      }

      case 'send_zip_and_enter_zipped': {
        if (!(await this.matchesCurrentSnapshot(sub))) return;

        const sent = await this.sendZipToOwner(sub.companyId);
        if (!sent) {
          // Stay in BLOCKED: the owner must receive their data before moving toward deletion.
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

  private async matchesCurrentSnapshot(sub: CompanySubscription): Promise<boolean> {
    const fresh = await prisma.companySubscription.findUnique({
      where: { companyId: sub.companyId },
      select: { status: true, lastPolarFactAt: true },
    });
    if (!fresh) return false;
    return fresh.status === sub.status && sameInstant(fresh.lastPolarFactAt, sub.lastPolarFactAt);
  }

  /** Returns `false` (never throws) when there is no owner or the export/send fails. */
  private async sendZipToOwner(companyId: string): Promise<boolean> {
    const owner = await this.findOldestOwner(companyId);

    if (!owner) {
      this.logger.error(`Company ${companyId} has no OWNER membership — cannot send its data export`);
      return false;
    }

    try {
      const zip = await this.exportService.buildCompanyZip(companyId);
      const t = mailT(owner.language);
      await this.mailService.sendForCompany(companyId, {
        to: owner.email,
        subject: t('dataExport.subject'),
        text: t('billingZipExport.body'),
        attachments: [{ filename: 'invoicerr-export.zip', content: zip, contentType: 'application/zip' }],
      });
      return true;
    } catch (error) {
      // Size/time bound errors are logged distinctly from transient mail or rendering outages.
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

  /** Oldest owner, so "the owner" is deterministic when a company has several. */
  private async findOldestOwner(
    companyId: string,
  ): Promise<{ email: string; language: ReturnType<typeof resolveUserLanguage> } | null> {
    const ownerMembership = await prisma.userCompany.findFirst({
      where: { companyId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, locale: true } }, company: { select: { language: true } } },
    });
    if (!ownerMembership) return null;
    return {
      email: ownerMembership.user.email,
      language: resolveUserLanguage(ownerMembership.user.locale, ownerMembership.company?.language),
    };
  }

  /**
   * Sends through the instance mail provider (`sendMail`, not `sendForCompany`). Each milestone is
   * recorded right after its own send so a mid-loop failure never marks an unsent one as sent.
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

    const owner = await this.findOldestOwner(sub.companyId);
    if (!owner) {
      this.logger.error(`Company ${sub.companyId} has no OWNER membership — cannot send billing warnings`);
      return;
    }

    const appUrl = appOrigin();

    for (const milestone of due) {
      const daysRemaining = milestone.endsWith('_d7') ? 7 : 1;
      const email = milestone.startsWith('blocked_')
        ? buildBlockedZipWarningEmail({ appUrl, daysRemaining, language: owner.language })
        : buildDeletionWarningEmail({ appUrl, daysRemaining, language: owner.language });

      try {
        await this.mailService.sendMail({
          to: owner.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      } catch (error) {
        this.logger.error(`Billing warning mail (${milestone}) failed for company ${sub.companyId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue; // not marked sent, so the next tick retries this milestone.
      }

      await prisma.companySubscription.update({
        where: { companyId: sub.companyId },
        data: { billingWarningMilestonesSent: { push: milestone } },
      });
      result.warningsSent++;
    }
  }

  /** `syncPolarCustomerOnCompanyChange` clears or re-stamps `customerSyncFailedAt` itself. */
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

/** Two `Date` instances holding the same instant are never `===`. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

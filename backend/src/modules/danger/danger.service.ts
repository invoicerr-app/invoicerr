import { MailService } from '@/mail/mail.service';
import { mailT } from '@/mail/i18n';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';

import { generateOtpCode, hashOtpCode, otpCodeMatches } from '@/modules/documents/signatures/otp';
import { deleteArchivedArtifacts } from '@/modules/documents/archive/storage';
import { deleteInboundFilesForCompany } from '@/modules/documents/received-invoices/storage';
import { BillingExportService } from '@/modules/billing/export-zip.service';
import { deleteCompanyPermanentlyNow, PolarCancellationFailedError } from '@/modules/billing/deletion';
import {
  clearDangerOtp,
  findDangerOtp,
  mintDangerOtp,
  recordDangerOtpFailedAttempt,
} from './danger-otp.persistence';

const OTP_EXPIRATION_MINUTES = 10;

/** Same generic refusal regardless of WHY the check failed (wrong code, expired, never requested, or
 *  already locked out) — the identical "one outcome" discipline `signatures.service.ts#GENERIC_BLOCK_
 *  MESSAGE` documents, so a caller can never learn from the response alone which of those it hit. */
const GENERIC_OTP_FAILURE_MESSAGE = 'Invalid or expired OTP';

/** The one code a caller can rely on to mean "this company still has documents under legal
 *  retention" — mirrors `billing/write-gate.ts#COMPANY_BLOCKED`'s own "a named code, not just a
 *  message to string-match" convention. */
export const RETENTION_BLOCKED = 'RETENTION_BLOCKED';

export interface CompanyDataResetCounts {
  documents: number;
  clients: number;
  articles: number;
  projects: number;
  timeEntries: number;
  bankStatements: number;
  archives: number;
}

export interface CompanyDataResetPreflight {
  blocked: boolean;
  /** How many DISTINCT documents still have at least one archive under legal retention — never a
   *  raw archive-ROW count: a single document can carry more than one archive (a re-send after
   *  "send_failed" archives again, and a terminal authority verdict archives a second time on top of
   *  its own delivery — see `DocumentArchive`'s own header), which would double-count the same
   *  document and overstate what is actually blocking the reset. */
  retainedDocuments: number;
  /** The LATEST `retentionUntil` among every retained archive — the date the screen shows the owner
   *  as "come back after this". `null` only when `blocked` is `false`. */
  retentionUntil: string | null;
  counts: CompanyDataResetCounts;
}

@Injectable()
export class DangerService {
  constructor(
    private readonly mailService: MailService,
    private readonly exportService: BillingExportService,
  ) {}

  async requestOtp(user: CurrentUser, companyId: string) {
    const code = generateOtpCode();
    const { minted } = await mintDangerOtp(companyId, hashOtpCode(code));

    if (!minted) {
      // `mintDangerOtp` refuses once this company's row is permanently locked (see that function's own
      // header) — reported as a distinct, explicit message here rather than the generic OTP-check
      // failure above: there is no code in flight yet for the caller to have gotten wrong, so folding
      // this into `GENERIC_OTP_FAILURE_MESSAGE` would be actively misleading rather than merely vague.
      logger.warn(
        'OTP request refused — this company is permanently locked out after too many failed attempts',
        {
          category: 'danger',
          details: { userId: user.id, companyId },
        },
      );
      throw new BadRequestException(
        'Too many failed attempts. This action is locked for this company and can no longer be confirmed by OTP.',
      );
    }

    try {
      // The company → instance → named refusal cascade (`MailService#sendForCompany`) — this route is
      // OWNER-only and gated by the SAME active-company resolution the reset actions below already
      // require (`RolesGuard` only ever sets `request.role` from the session's `activeRole`, which is
      // itself derived from `activeCompanyId` — see `guards/auth.guard.ts` — so an OWNER reaching this
      // handler at all already has an active company), so this OTP goes out through THAT company's own
      // mail server when it has one, never the instance's.
      //
      // Language: the ACTING user's own preference (`resolveUserLanguage`), never `resolveRecipientLanguage`
      // — this mail is addressed to the person confirming their own destructive action, not to a
      // document's external recipient. No company-language fallback here: this route is not on the
      // document-render path, and adding a second query just to widen a fallback that only matters for
      // a user with no personal preference AND no client-facing document context is not worth it.
      const t = mailT(resolveUserLanguage(user.locale, undefined));
      await this.mailService.sendForCompany(companyId, {
        // F-012: this used to send to SMTP_FROM/SMTP_USER — the instance's own technical mailbox,
        // not the person authorising the destructive action. Anyone able to read that mailbox could
        // authorise; the requester could not.
        to: user.email,
        subject: t('dangerOtp.subject'),
        text: t('dangerOtp.body', { code, minutes: OTP_EXPIRATION_MINUTES }),
      });
    } catch (error) {
      // `sendForCompany`'s own named refusal (no mail server configured anywhere) is a
      // `BadRequestException` that already names the actual problem — rethrown verbatim, never folded
      // into the generic message below, for the same reason `signatures.service.ts#sendTemplatedMail`
      // does the same thing. Any other failure (a real provider error) still collapses to the generic
      // message; the real one is logged, never shown to the caller.
      if (error instanceof HttpException) throw error;
      logger.error('Failed to send OTP email', { category: 'danger', details: { error } });
      throw new BadRequestException('Failed to send OTP email. Please check your SMTP configuration.');
    }

    logger.info('OTP sent', { category: 'danger', details: { userId: user.id, companyId } });
    return { message: 'OTP sent successfully' };
  }

  /**
   * Verifies `submittedOtp` against this COMPANY's own current challenge (never a different one — see
   * `DangerOtp.companyId`'s own uniqueness) and, on success, consumes it — a code authorises exactly
   * ONE destructive action, never a replay. A code is "live" only while it exists, is not locked, and
   * has not expired; `otpCodeMatches` is only ever evaluated once all three hold, mirroring
   * `signatures.service.ts#verifyAndSign`'s own "no digest comparison is even meaningful against a
   * hash that no longer represents the current, live challenge" discipline.
   *
   * Every non-succeeding call consumes one lifetime attempt — wrong code, expired code, or no code at
   * all — folded into the SAME counter and the SAME generic message for the same reason
   * `signatures.service.ts` folds its own three failure modes together: never give a caller a signal
   * to narrow their next guess by.
   */
  private async verifyAndConsumeOtp(companyId: string, submittedOtp: string): Promise<void> {
    const normalized = submittedOtp.replace(/-/g, '');
    const record = await findDangerOtp(companyId);

    const codeIsLive = !!record && !record.lockedAt && record.expiresAt.getTime() > Date.now();
    const matches = codeIsLive && otpCodeMatches(normalized, record!.codeHash);

    if (!matches) {
      if (record && !record.lockedAt) {
        await recordDangerOtpFailedAttempt(companyId);
      }
      throw new BadRequestException(GENERIC_OTP_FAILURE_MESSAGE);
    }

    await clearDangerOtp(companyId);
  }

  /**
   * What a company would lose (and what blocks it) if "Reset company data" ran RIGHT NOW — read by
   * `GET /danger/reset/company-data/preflight`, called by the settings screen BEFORE the OTP flow
   * even starts, so a company under legal retention sees why it cannot reset before it ever types a
   * confirmation code. `resetCompanyData` below calls this AGAIN, after the OTP is spent, as the real
   * enforcement — this method only ever REPORTS the fact, never blocks anything on its own.
   */
  async getCompanyDataResetPreflight(companyId: string): Promise<CompanyDataResetPreflight> {
    const retainedArchives = await prisma.documentArchive.findMany({
      where: { companyId, retentionUntil: { gt: new Date() } },
      select: { documentId: true, retentionUntil: true },
      orderBy: { retentionUntil: 'desc' },
    });
    const retainedDocumentIds = new Set(retainedArchives.map((archive) => archive.documentId));

    const [documents, clients, articles, projects, timeEntries, bankStatements, archives] = await Promise.all(
      [
        prisma.documentInstance.count({ where: { companyId } }),
        prisma.client.count({ where: { companyId } }),
        prisma.article.count({ where: { companyId } }),
        prisma.project.count({ where: { companyId } }),
        prisma.timeEntry.count({ where: { companyId } }),
        prisma.bankStatement.count({ where: { companyId } }),
        prisma.documentArchive.count({ where: { companyId } }),
      ],
    );

    return {
      blocked: retainedDocumentIds.size > 0,
      retainedDocuments: retainedDocumentIds.size,
      // Rows are ordered `retentionUntil desc` above, so the first one is the LATEST date — the one
      // the owner actually needs to wait out (the shortest-lived retained document is not the blocker).
      retentionUntil: retainedArchives[0]?.retentionUntil?.toISOString() ?? null,
      counts: { documents, clients, articles, projects, timeEntries, bankStatements, archives },
    };
  }

  /**
   * "Reset company data" — deletes every document (every type: invoices, quotes, credit notes,
   * expenses, received invoices — all one `DocumentInstance` table, see CLAUDE.md's own "the
   * documents module" section), client, article, project, time entry, bank statement/reconciliation,
   * archived file and uploaded attachment this company holds. Deliberately KEEPS the company row
   * itself, its members, its subscription, its channel connections and its e-mail templates — every
   * COMPANY-scoped table this method does NOT touch above is a deliberate "this is configuration, not
   * exploitation data" call, not an oversight.
   *
   * Refuses outright (409, `RETENTION_BLOCKED`) while any archived document is still inside its own
   * legal retention window (`archive/retention/` — the country-is-data catalog `DocumentArchive.
   * retentionUntil` was resolved from at archiving time) — deleting the DATABASE row that proves a
   * legally-retained document ever existed would defeat the retention obligation even if the archived
   * BYTES themselves survived on disk.
   */
  async resetCompanyData(user: CurrentUser, companyId: string, otp: string) {
    try {
      await this.verifyAndConsumeOtp(companyId, otp);
    } catch (error) {
      logger.warn('Invalid or expired OTP for resetCompanyData', {
        category: 'danger',
        details: { userId: user.id },
      });
      throw error;
    }

    const preflight = await this.getCompanyDataResetPreflight(companyId);
    if (preflight.blocked) {
      // Defense in depth, not the primary guard — the SCREEN already disables this action once
      // `GET .../preflight` reports `blocked` (see danger.settings.tsx), so reaching this branch means
      // either a genuine race (implausible: retention windows run for years, not the seconds between
      // the screen's own preflight read and this call) or a caller bypassing the UI entirely. Either
      // way the OTP above is already spent — a legitimate retry simply requests a fresh one.
      logger.warn('Company data reset refused — documents still under legal retention', {
        category: 'danger',
        details: { userId: user.id, companyId, retainedDocuments: preflight.retainedDocuments },
      });
      throw new ConflictException({
        message:
          `${preflight.retainedDocuments} document(s) are still under legal retention until ` +
          `${preflight.retentionUntil} — refusing to reset. Nothing was deleted.`,
        code: RETENTION_BLOCKED,
        retainedDocuments: preflight.retainedDocuments,
        retentionUntil: preflight.retentionUntil,
      });
    }

    // Read BEFORE the transaction: once `documentInstance.deleteMany` runs, the FK cascade
    // (`DocumentArchive.document`, `onDelete: Cascade`) removes these rows too, taking their own
    // `uri` column with them — this is the last moment the bytes each row points at are still
    // reachable at all.
    const archives = await prisma.documentArchive.findMany({ where: { companyId }, select: { uri: true } });

    await prisma.$transaction(async (tx) => {
      // `DocumentSchedule.sourceDocumentId` is a plain string, never a `@relation` (schema.prisma's
      // own header on that model explains why) — it does NOT cascade when its source document is
      // deleted below, so a schedule left behind would keep trying to replay a document that no
      // longer exists. Deleted first, deliberately, though nothing here strictly depends on the order.
      await tx.documentSchedule.deleteMany({ where: { companyId } });
      // Cascades (real `ON DELETE CASCADE`, not merely a Prisma-level convenience — every one of
      // these relations is declared `onDelete: Cascade` in schema.prisma): DocumentPayment,
      // DocumentReminder, DocumentArchive, DocumentAuthorityEvent, DocumentDownloadToken, Signature,
      // PaymentCheckoutSession. TimeEntry.documentId and BankStatementLine.reconciledDocumentId/
      // reconciledPaymentId are `onDelete: SetNull` instead (a time entry or a bank line is a fact
      // about real work/money, kept even once the document it was attached to is gone) — both tables
      // are deleted explicitly below anyway, per this action's own scope.
      await tx.documentInstance.deleteMany({ where: { companyId } });
      // The per-(company, type) "next number" counter — left in place, numbering would silently
      // resume from wherever it last stopped despite every document that ever took a number now being
      // gone; reset alongside the documents themselves so a fresh start is actually fresh.
      await tx.documentNumberSequence.deleteMany({ where: { companyId } });
      await tx.timeEntry.deleteMany({ where: { companyId } });
      await tx.project.deleteMany({ where: { companyId } });
      // Cascades BankStatementLine (`onDelete: Cascade` on `BankStatementLine.statement`).
      await tx.bankStatement.deleteMany({ where: { companyId } });
      // Cascades Project (already deleted above; a no-op by the time this runs), ClientPortalToken,
      // and this client's own `PartyIdentifier` rows (the company's OWN identifiers use a separate,
      // `clientId`-less row — see that model's own header — and are never touched here).
      await tx.client.deleteMany({ where: { companyId } });
      await tx.article.deleteMany({ where: { companyId } });
    });

    // File cleanup runs AFTER the transaction commits, deliberately: the database is the source of
    // truth for whether this company's data is gone, and a storage hiccup here must never roll back
    // rows that were correctly deleted, nor make a fully-successful reset look like it failed. Every
    // failure below is logged and swallowed — best effort, exactly like `export-zip.service.ts`'s own
    // temp-file cleanup.
    for (const { uri } of archives) {
      await deleteArchivedArtifacts(uri).catch((error) => {
        logger.error('Company data reset: could not delete an archived artifact from storage', {
          category: 'danger',
          details: { companyId, uri, error: error instanceof Error ? error.message : String(error) },
        });
      });
    }
    try {
      await deleteInboundFilesForCompany(companyId);
    } catch (error) {
      logger.error("Company data reset: could not delete this company's inbound files", {
        category: 'danger',
        details: { companyId, error: error instanceof Error ? error.message : String(error) },
      });
    }

    logger.info('Company data reset successfully', {
      category: 'danger',
      details: { userId: user.id, companyId, counts: preflight.counts },
    });
    return { message: 'Company data reset successfully' };
  }

  /**
   * "Delete company" — the irreversible one. Reuses the exact same SaaS path a company already goes
   * through when its own billing lifecycle deletes it (`billing/billing-lifecycle-sweep-runner.ts`):
   * mail the OWNER a full data export FIRST (`BillingExportService`, this company's last copy), then
   * cancel any live Polar subscription and delete the `Company` row (`billing/deletion.ts#
   * deleteCompanyPermanentlyNow`) — refusing outright, at every step, rather than deleting anything
   * while the export or the cancellation could not be confirmed. On a self-hosted instance with no
   * billing configured, `deleteCompanyPermanentlyNow` finds no `CompanySubscription` row at all and
   * simply never calls Polar — the SAME code path, not a separate one.
   *
   * The typed `companyName` is a SECOND, independent proof on top of the OTP: the OTP proves "you
   * received the code we mailed to you"; retyping the company's own exact name proves "you know which
   * company you are about to permanently destroy" — a wrong OTP already refuses via the generic
   * message above, so a wrong name gets its own, equally loud refusal rather than being silently
   * accepted because a valid code happened to be in hand.
   */
  async deleteCompany(user: CurrentUser, companyId: string, otp: string, companyName: string) {
    try {
      await this.verifyAndConsumeOtp(companyId, otp);
    } catch (error) {
      logger.warn('Invalid or expired OTP for deleteCompany', {
        category: 'danger',
        details: { userId: user.id },
      });
      throw error;
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, language: true },
    });
    if (!company) {
      throw new BadRequestException('This company no longer exists.');
    }
    if (companyName !== company.name) {
      logger.warn('Company deletion refused — typed company name did not match', {
        category: 'danger',
        details: { userId: user.id, companyId },
      });
      throw new BadRequestException('Company name does not match — nothing was deleted.');
    }

    let zip: Buffer;
    try {
      zip = await this.exportService.buildCompanyZip(companyId);
    } catch (error) {
      logger.error('Company deletion refused — could not build the data export', {
        category: 'danger',
        details: {
          userId: user.id,
          companyId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new BadRequestException(
        'Could not build your data export — deletion refused. Nothing was deleted; try again shortly.',
      );
    }

    try {
      // To the ACTING user's own inbox, not "the oldest OWNER" the automated sweep addresses (see
      // `billing-lifecycle-sweep-runner.ts#findOldestOwner`) — this call has a real, already-
      // authenticated OWNER in hand, so the same F-012 "the export reaches the person requesting it"
      // discipline `requestOtp` above already holds applies here too.
      //
      // Language: the ACTING user's own preference, falling back to this company's own language (free
      // here — `company` was already fetched above for its `name`) rather than straight to English,
      // the same two-step chain `resolveUserLanguage` documents for a user with no personal choice.
      const t = mailT(resolveUserLanguage(user.locale, company.language));
      await this.mailService.sendForCompany(companyId, {
        to: user.email,
        subject: t('dataExport.subject'),
        text: t('dangerDeleteCompany.body', {
          companyName: company.name,
          interpolation: { escapeValue: false },
        }),
        attachments: [{ filename: 'invoicerr-export.zip', content: zip, contentType: 'application/zip' }],
      });
    } catch (error) {
      if (error instanceof HttpException) throw error; // e.g. NO_MAIL_SERVER_CONFIGURED_MESSAGE, already named
      logger.error('Company deletion refused — could not email the data export', {
        category: 'danger',
        details: {
          userId: user.id,
          companyId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new BadRequestException(
        'Could not email your data export — deletion refused. Nothing was deleted.',
      );
    }

    try {
      await deleteCompanyPermanentlyNow(companyId);
    } catch (error) {
      if (error instanceof PolarCancellationFailedError) {
        logger.error("Company deletion refused — this company's Polar subscription could not be cancelled", {
          category: 'danger',
          details: { userId: user.id, companyId, error: error.message },
        });
        throw new BadGatewayException(
          "Could not cancel this company's subscription — deletion refused. Nothing was deleted; try again shortly.",
        );
      }
      throw error;
    }

    // `companyId` omitted, deliberately — it defers to the ambient request context (see
    // `logger.service.ts#LogOptions.companyId`'s own header), which already holds this exact id: the
    // ROW is gone by this point, but the fact "this id used to name a company, now deleted" is still
    // an honest, expected shape for `Log.companyId` to carry (its own schema comment says as much).
    logger.info('Company permanently deleted', {
      category: 'danger',
      details: { userId: user.id, companyId },
    });
    return { message: 'Company deleted successfully' };
  }
}

import { mkdirSync, rmSync } from 'node:fs';

import { BadRequestException, Injectable } from '@nestjs/common';

import { runWithCompanyId } from '@/lib/request-context';
import { logger } from '@/logger/logger.service';
import { mailT } from '@/mail/i18n';
import { MailService } from '@/mail/mail.service';
import { deleteArchivedArtifacts } from '@/modules/documents/archive/storage';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';
import { inboundRoot } from '@/modules/documents/received-invoices/storage';
import { generateOtpCode, hashOtpCode, otpCodeMatches } from '@/modules/documents/signatures/otp';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';

import {
  clearInstanceResetOtp,
  findInstanceResetOtp,
  mintInstanceResetOtp,
  recordInstanceResetOtpFailedAttempt,
} from './instance-reset-otp.persistence';
import { INSTANCE_RESET_TABLES } from './reset-tables';

const OTP_EXPIRATION_MINUTES = 10;

/** Typed exactly, case-sensitively — the strongest confirmation this screen can ask for short of
 *  inventing a second endpoint: unlike `danger.settings.tsx`'s own "reset all" (which can fall back
 *  to the ACTIVE company's own name), an instance-wide wipe has no single company name to ask for —
 *  every company on the deployment is about to go. */
export const RESET_INSTANCE_CONFIRMATION_WORD = 'RESET INSTANCE';

/** Same generic refusal regardless of WHY the check failed (wrong code, expired, never requested, or
 *  already locked out) — the identical "one outcome" discipline `danger.service.ts#GENERIC_OTP_
 *  FAILURE_MESSAGE` documents, so a caller can never learn from the response alone which of those it
 *  hit. */
const GENERIC_OTP_FAILURE_MESSAGE = 'Invalid or expired OTP';

@Injectable()
export class InstanceResetService {
  constructor(private readonly mailService: MailService) {}

  async requestOtp(user: CurrentUser) {
    const code = generateOtpCode();
    const { minted } = await mintInstanceResetOtp(user.email, hashOtpCode(code));

    if (!minted) {
      // INSTANCE-LEVEL-LOG: an instance-wide OTP request has no company to scope this warning to.
      logger.warn(
        'Instance-reset OTP request refused — this operator is permanently locked out after too ' +
          'many failed attempts',
        { category: 'instance', companyId: null, details: { userId: user.id } },
      );
      throw new BadRequestException(
        'Too many failed attempts. This action is locked for this account and can no longer be ' +
          'confirmed by OTP.',
      );
    }

    try {
      // Instance-level send ONLY (`mailService.sendMail`, never `sendForCompany`) — an instance-wide
      // wipe is not scoped to any one company's own mail server, and the caller reaching this route at
      // all already proves they are an instance operator, not merely a member of whichever company
      // happens to be active in their session right now.
      //
      // Language: the operator's own `User.locale`, via `resolveUserLanguage` — the SAME resolver
      // every other authenticated-user mail in this codebase uses (`danger.service.ts`,
      // `account-lifecycle.ts`). The second argument is `null`, never a company id: an instance
      // operator acts outside any one company's scope here (this action reaches every company on the
      // deployment at once), so there is no `Company.language` to fall back to before the instance's
      // own `DEFAULT_LOCALE` — the cascade is operator locale → DEFAULT_LOCALE → English.
      const t = mailT(resolveUserLanguage(user.locale, null));
      await this.mailService.sendMail({
        to: user.email,
        subject: t('instanceResetOtp.subject'),
        text: t('instanceResetOtp.body', { code, minutes: OTP_EXPIRATION_MINUTES }),
      });
    } catch (error) {
      // INSTANCE-LEVEL-LOG: same instance-wide OTP flow as above — no company scope applies.
      logger.error('Failed to send instance-reset OTP email', {
        category: 'instance',
        companyId: null,
        details: { error },
      });
      throw new BadRequestException(
        'Failed to send OTP email. Please check this instance’s mail configuration.',
      );
    }

    // INSTANCE-LEVEL-LOG: same instance-wide OTP flow as above — no company scope applies.
    logger.info('Instance-reset OTP sent', {
      category: 'instance',
      companyId: null,
      details: { userId: user.id },
    });
    return { message: 'OTP sent successfully' };
  }

  /** Same "every non-succeeding call consumes one lifetime attempt" discipline `danger.service.ts#
   *  verifyAndConsumeOtp` documents for its own per-company challenge. */
  private async verifyAndConsumeOtp(email: string, submittedOtp: string): Promise<void> {
    const normalized = submittedOtp.replace(/-/g, '');
    const record = await findInstanceResetOtp(email);

    const codeIsLive = !!record && !record.lockedAt && record.expiresAt.getTime() > Date.now();
    const matches = codeIsLive && otpCodeMatches(normalized, record!.codeHash);

    if (!matches) {
      if (record && !record.lockedAt) {
        await recordInstanceResetOtpFailedAttempt(email);
      }
      throw new BadRequestException(GENERIC_OTP_FAILURE_MESSAGE);
    }

    await clearInstanceResetOtp(email);
  }

  /**
   * Wipes the ENTIRE instance: every company, user, document and stored file, then signs everyone
   * out. Requires BOTH a fresh, verified OTP (`requestOtp` above) AND the exact confirmation word —
   * two independent proofs, so a stolen/guessed OTP alone (e.g. an operator's mailbox briefly
   * compromised) is never enough on its own, the same "two independent factors" shape `danger.
   * service.ts`'s OTP-plus-typed-keyword confirmation already holds for a much narrower blast radius.
   *
   * The whole body runs inside `runWithCompanyId(null, ...)` — not merely passing `companyId: null` to
   * the final `Log` write, but genuinely entering a null-company async context for this action's whole
   * execution. `logger.service.ts` has a TEST-ONLY tripwire that flags an explicit `companyId: null`
   * write made while some OTHER company is still the ambient one as "almost certainly a copy-pasted
   * instance-level call site that escaped its own company's scope" — correct for nearly every call
   * site, but this one is genuinely instance-wide: the caller reached this route as an instance
   * operator, quite possibly with some unrelated company still active in their own session, and that
   * company must never be the one this action's own log line (or anything it does) gets attributed to.
   */
  async reset(user: CurrentUser, otp: string, confirmationWord: string): Promise<{ message: string }> {
    if (confirmationWord !== RESET_INSTANCE_CONFIRMATION_WORD) {
      throw new BadRequestException(
        `Type "${RESET_INSTANCE_CONFIRMATION_WORD}" exactly to confirm this action`,
      );
    }

    try {
      await this.verifyAndConsumeOtp(user.email, otp);
    } catch (error) {
      // INSTANCE-LEVEL-LOG: instance reset is cross-tenant by construction — no single company applies.
      logger.warn('Invalid or expired OTP for instance reset', {
        category: 'instance',
        companyId: null,
        details: { userId: user.id },
      });
      throw error;
    }

    return runWithCompanyId(null, async () => {
      // Every archived legal document's bytes are tracked by `DocumentArchive.uri` — read BEFORE the
      // truncate below erases that row, and removed through the SAME storage abstraction the archive
      // module itself writes through (`deleteArchivedArtifacts`, dispatching on the uri's own scheme
      // to either a local directory removal or an S3 prefix delete — see `archive/storage.ts`'s own
      // header), never a second, hand-rolled deletion path.
      const archives = await prisma.documentArchive.findMany({ select: { uri: true } });

      await prisma.$transaction(async (tx) => {
        const tableList = INSTANCE_RESET_TABLES.map((table) => `"${table}"`).join(', ');
        // TRUNCATE, never DELETE-per-table: see `reset-tables.ts`'s own header for why CASCADE (which
        // reads the live FK graph itself) is preferred over a hand-maintained delete order for ~50
        // models. `_prisma_migrations` is never in `INSTANCE_RESET_TABLES` — see that file's own spec.
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE;`);
      });

      await Promise.all(archives.map(({ uri }) => deleteArchivedArtifacts(uri)));

      // Received-invoice uploads, expense attachments and company logos all share ONE local,
      // content-addressed root (`received-invoices/storage.ts`'s own header) with no per-file DB
      // tracking and no S3 backend of its own — wiping the whole root, obtained from that module's own
      // exported resolver (never a hardcoded path), IS the storage abstraction's bulk-delete
      // primitive; nothing else in this codebase needs a narrower one. Recreated empty immediately
      // after so the next upload does not have to `mkdirSync` its way past a missing root.
      const root = inboundRoot();
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });

      // Truncating the `session` table above already signs out every session on this instance — better
      // -auth resolves a session by looking the cookie's id up in that table, and that lookup now
      // fails for all of them, the same way it would for a session whose row was deleted any other way.
      // INSTANCE-LEVEL-LOG: instance reset touches every company on the deployment at once.
      logger.info('Instance reset — every company, user and document on this deployment was wiped', {
        category: 'instance',
        companyId: null,
        details: { userId: user.id },
      });

      return { message: 'Instance reset successfully' };
    });
  }
}

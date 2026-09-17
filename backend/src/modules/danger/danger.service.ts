import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, HttpException, Injectable, NotImplementedException } from '@nestjs/common';
import { logger } from '@/logger/logger.service';

import { generateOtpCode, hashOtpCode, otpCodeMatches } from '@/modules/documents/signatures/otp';
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

@Injectable()
export class DangerService {
  constructor(private readonly mailService: MailService) {}

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
      // OWNER-only and gated by the SAME active-company resolution `resetApp`/`resetAll` below already
      // require (`RolesGuard` only ever sets `request.role` from the session's `activeRole`, which is
      // itself derived from `activeCompanyId` — see `guards/auth.guard.ts` — so an OWNER reaching this
      // handler at all already has an active company), so this OTP goes out through THAT company's own
      // mail server when it has one, never the instance's.
      await this.mailService.sendForCompany(companyId, {
        // F-012: this used to send to SMTP_FROM/SMTP_USER — the instance's own technical mailbox,
        // not the person authorising the destructive action. Anyone able to read that mailbox could
        // authorise; the requester could not.
        to: user.email,
        subject: 'OTP Code Sent',
        text: `Your confirmation code for a destructive action on Invoicerr is: ${code}. It is valid for ${OTP_EXPIRATION_MINUTES} minutes. If you did not request this, ignore this message.`,
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

  async resetApp(user: CurrentUser, companyId: string, otp: string) {
    try {
      await this.verifyAndConsumeOtp(companyId, otp);
    } catch (error) {
      logger.warn('Invalid or expired OTP for resetApp', {
        category: 'danger',
        details: { userId: user.id },
      });
      throw error;
    }

    // Reset everything for this company only, but the user data
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.mailTemplate.deleteMany({ where: { companyId } });
    await prisma.client.deleteMany({ where: { companyId } });

    logger.info('Application reset successfully', {
      category: 'danger',
      details: { userId: user.id, companyId },
    });
    return { message: 'Application reset successfully' };
  }

  async resetAll(user: CurrentUser, companyId: string, otp: string) {
    try {
      await this.verifyAndConsumeOtp(companyId, otp);
    } catch (error) {
      logger.warn('Invalid or expired OTP for resetAll', {
        category: 'danger',
        details: { userId: user.id },
      });
      throw error;
    }

    // F-011: this method never deleted anything — it cleared the OTP and returned
    // "All data reset successfully". A destructive operation the user explicitly confirmed must
    // not report success it did not perform: they would believe their data gone. Until the reset is
    // actually implemented, fail loudly rather than lie. The OTP is already consumed above (by
    // `verifyAndConsumeOtp`), matching the original behavior of never leaving it replayable even though
    // the reset itself is not implemented yet.
    logger.error('resetAll called but not implemented — refusing to report success', {
      category: 'danger',
      details: { userId: user.id, companyId },
    });
    throw new NotImplementedException(
      'Full reset is not implemented yet. Nothing was deleted. Use "Reset app data" to clear documents for this company.',
    );
  }
}

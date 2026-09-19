/**
 * Verifies and consumes the SAME per-company OTP challenge the danger zone mints
 * (`POST /danger/otp`, `danger-otp.persistence.ts`) — ownership transfer deliberately reuses that one
 * shared challenge rather than minting a second, parallel OTP scheme for one more destructive-ish
 * action.
 *
 * This is a near-duplicate of `danger.service.ts#verifyAndConsumeOtp`, which is `private` and lives in
 * a file this feature does not own — so instead of exporting it there, this calls the exact same
 * exported persistence functions (`danger-otp.persistence.ts`) and the exact same `otpCodeMatches`
 * primitive that method does, so the two can never disagree on what counts as a valid, live code; only
 * the small orchestration around them (check → record a failed attempt → consume) is repeated.
 */
import { BadRequestException } from '@nestjs/common';

import {
  clearDangerOtp,
  findDangerOtp,
  recordDangerOtpFailedAttempt,
} from '@/modules/danger/danger-otp.persistence';
import { otpCodeMatches } from '@/modules/documents/signatures/otp';

/** Same generic refusal `danger.service.ts` itself uses for its own confirm endpoints — one outcome
 *  whatever the actual cause (wrong code, expired, never requested, already locked out), so a caller
 *  can never narrow a guess from the response alone. */
const GENERIC_OTP_FAILURE_MESSAGE = 'Invalid or expired OTP';

export async function verifyAndConsumeDangerOtp(companyId: string, submittedOtp: string): Promise<void> {
  const normalized = (submittedOtp ?? '').replace(/-/g, '');
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

/**
 * Verifies and consumes the SAME per-company OTP challenge the danger zone mints
 * (`POST /danger/otp`, `danger-otp.persistence.ts`) - ownership transfer
 * (`modules/company/transfer/transfer.service.ts`) deliberately reuses that one shared challenge rather
 * than minting a second, parallel OTP scheme for one more destructive-ish action.
 *
 * The check itself is `lib/otp.ts#verifyAndConsumeOtp`, the very same helper `danger.service.ts` calls
 * for its own confirm endpoints, fed the very same persistence functions - so the two can never
 * disagree on what counts as a valid, live code. The one difference kept here is the `?? ''` guard on
 * `submittedOtp`, which this entry point has always had and `danger.service.ts` never did.
 */
import { verifyAndConsumeOtp } from '@/lib/otp';
import {
  clearDangerOtp,
  findDangerOtp,
  recordDangerOtpFailedAttempt,
} from '@/modules/danger/danger-otp.persistence';

export async function verifyAndConsumeDangerOtp(companyId: string, submittedOtp: string): Promise<void> {
  await verifyAndConsumeOtp(
    { find: findDangerOtp, recordFailure: recordDangerOtpFailedAttempt, clear: clearDangerOtp },
    companyId,
    submittedOtp ?? '',
  );
}

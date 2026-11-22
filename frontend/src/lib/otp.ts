/** Six/eight-digit one-time codes are shown grouped (`1234-5678`) everywhere they are typed or
 *  displayed; non-digits are dropped so a pasted code works too. */
export function formatOtp(value: string): string {
  const cleaned = value.replace(/\D/g, "").slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

/** `formatOtp`'s output length for a complete code: 8 digits and one dash ("1234-5678"). */
export const OTP_DISPLAY_LENGTH = 9

/** Whether a `formatOtp`-formatted code has all its digits. */
export function isOtpComplete(otp: string): boolean {
  return otp.length === OTP_DISPLAY_LENGTH
}

/** Used by the instance reset and danger-zone dialogs. The confirm step's own OTP failures stay
 *  deliberately generic no matter the cause (wrong code, expired, or already locked: the backend folds all three into the same message on purpose, so a
 *  caller here can never narrow down a guess). The ONE outcome the backend does surface distinctly is
 *  the permanent lockout on the REQUEST step itself (five failed confirmations, for good), matched on
 *  the response text since that refusal carries no separate error code, only this one stable phrase. */
export function isOtpLockedError(error: unknown): boolean {
  return error instanceof Error && /locked/i.test(error.message)
}

/**
 * The quote e-signature's own OTP POLICY: how long one code lives and how often it may be re-armed.
 * The code's crypto (CSPRNG, hashing, timing-safe compare) and the lifetime attempt budget
 * (`MAX_FAILED_ATTEMPTS`) are shared with the danger zone, the instance reset and the company
 * transfer, and live in `lib/otp.ts`.
 */

/** 5 minutes — down from the removed module's own 15 (a deliberate hardening). */
export const OTP_WINDOW_MS = 5 * 60 * 1000;

/** How many times `POST .../otp` may mint a fresh code for one signature row, ever — a THROTTLE on
 *  re-arming, never a widening of `lib/otp.ts#MAX_FAILED_ATTEMPTS` (each of these 3 codes is still
 *  bound by the SAME lifetime attempt counter, shared across every one of them). */
export const MAX_OTP_MINTS = 3;

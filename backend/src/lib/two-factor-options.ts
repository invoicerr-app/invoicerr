import type { TwoFactorOptions } from 'better-auth/plugins';

/**
 * Options of better-auth's two-factor plugin, kept out of `auth.ts` so a spec can assert them
 * without building the live Prisma adapter that importing `auth.ts` does.
 *
 * Only the authenticator app (TOTP) and backup codes are offered: no `otpOptions`, because email
 * codes would put the second factor in the same mailbox that already resets the password.
 */
export const TWO_FACTOR_OPTIONS = {
  // Shown as the account label in the authenticator app, instead of the library's default app name.
  issuer: 'Invoicerr',
  // A password is required to enable or disable the second factor and to regenerate backup codes,
  // so a stolen session alone cannot turn it off or read new codes.
  allowPasswordless: false,
  // Set explicitly rather than left to the library default: the six code boxes on the sign-in and
  // account pages are drawn from `TOTP_LENGTH` (`frontend/src/components/totp-code-input.tsx`), and
  // must stay equal to this.
  totpOptions: { digits: 6 as const },
} satisfies TwoFactorOptions;

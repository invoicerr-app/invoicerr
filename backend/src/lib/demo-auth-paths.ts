/**
 * Two-factor setup routes of better-auth's two-factor plugin. On a demo instance every visitor shares
 * one account, so whoever enabled a second factor there would lock every other visitor out.
 */
const TWO_FACTOR_LABEL = 'Changing two-factor authentication';

/**
 * Pure path-matching for `lib/auth.ts`'s own `hooks.before` demo-mode guard, pulled out into its own
 * file for the exact reason `sso-policy.ts`'s own functions are (see that file's own header, quoted
 * here since it applies verbatim): importing `lib/auth.ts` itself builds a live Prisma adapter, so no
 * spec in this codebase imports it directly. This one function is what a spec CAN drive, deterministically,
 * with no Prisma/network dependency at all.
 *
 * Better-auth's own route path, with no `/api/auth` prefix, confirmed against the installed
 * better-auth 1.7.4 route source (`node_modules/better-auth/dist/api/routes/update-user.mjs`).
 *
 * Each blocked path carries its own label, so a path added here has to say what it blocks.
 */
const DEMO_BLOCKED_AUTH_PATHS = new Map<string, string>([
  ['/change-email', 'Changing the account email'],
  ['/change-password', 'Changing the password'],
  ['/two-factor/enable', TWO_FACTOR_LABEL],
  ['/two-factor/disable', TWO_FACTOR_LABEL],
  ['/two-factor/generate-backup-codes', TWO_FACTOR_LABEL],
]);

export function isDemoBlockedAuthPath(path: string): boolean {
  return DEMO_BLOCKED_AUTH_PATHS.has(path);
}

/** Only meaningful for a path `isDemoBlockedAuthPath` accepts, the one way `lib/auth.ts` calls it. */
export function demoBlockedAuthActionLabel(path: string): string {
  return DEMO_BLOCKED_AUTH_PATHS.get(path) ?? TWO_FACTOR_LABEL;
}

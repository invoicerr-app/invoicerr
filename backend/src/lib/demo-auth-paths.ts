/**
 * Pure path-matching for `lib/auth.ts`'s own `hooks.before` demo-mode guard — pulled out into its own
 * file for the exact reason `sso-policy.ts`'s own functions are (see that file's own header, quoted
 * here since it applies verbatim): importing `lib/auth.ts` itself builds a live Prisma adapter, so no
 * spec in this codebase imports it directly. This one function is what a spec CAN drive, deterministically,
 * with no Prisma/network dependency at all.
 *
 * Better-auth's own route path, with no `/api/auth` prefix — confirmed against the installed
 * better-auth 1.7.4 route source (`node_modules/better-auth/dist/api/routes/update-user.mjs`).
 */
const DEMO_BLOCKED_AUTH_PATHS = new Set(['/change-email', '/change-password']);

export function isDemoBlockedAuthPath(path: string): boolean {
  return DEMO_BLOCKED_AUTH_PATHS.has(path);
}

export function demoBlockedAuthActionLabel(path: string): string {
  return path === '/change-email' ? 'Changing the account email' : 'Changing the password';
}

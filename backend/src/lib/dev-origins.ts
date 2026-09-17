/**
 * Whether the Vite dev-server origin (`http://localhost:5173`) should be trusted for CORS/cookies —
 * shared by `main.ts`'s `app.enableCors()` and `lib/auth.ts`'s own `trustedOrigins`, which used to each
 * hardcode it unconditionally. That meant a PRODUCTION deployment also trusted it: any page an attacker
 * got to run on `localhost:5173` on a victim's own machine (a cloned copy of this repo, a dev tool) could
 * read/write the API with the victim's session cookies, CORS explicitly allowing it.
 *
 * Its own file rather than living in `lib/auth.ts` directly: `main.ts` cannot import anything that
 * transitively touches `better-auth` under Jest (see `lib/body-parser-auth-skip.ts`'s own header for the
 * full account of why), so this stays a plain, dependency-free function both files can share without
 * that risk.
 */
export const DEV_FRONTEND_ORIGIN = 'http://localhost:5173';

/** Empty in production — the dev origin is only ever legitimate outside it. Takes `env` for
 *  testability, defaulting to `process.env` at real call sites, the same shape
 *  `lib/secret-guard.ts#assertSecretsConfiguredForBoot` already uses. */
export function devOnlyOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.NODE_ENV === 'production' ? [] : [DEV_FRONTEND_ORIGIN];
}

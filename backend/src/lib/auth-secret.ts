/**
 * The instance secret better-auth signs sessions with: `BETTER_AUTH_SECRET`, falling back to
 * `JWT_SECRET` so deployments that only ever set the older variable keep working.
 *
 * `lib/auth.ts` hands it to better-auth, and two purpose-specific keys are derived from it
 * (`lib/invitation-code.ts`, `documents/payment-ledger/ledger-hash.ts`). All three used to spell the
 * fallback out by hand; a copy that drifted would make invitation codes or ledger signatures stop
 * verifying in silence, so they now read this one function.
 *
 * Plain `||`, exactly as before: an empty `BETTER_AUTH_SECRET` falls through to `JWT_SECRET`, and
 * `undefined` comes back when neither is set (better-auth then applies its own default).
 * `lib/secret-guard.ts#findInsecureSecret` keeps its own check and is deliberately not routed here.
 */
export function effectiveAuthSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.BETTER_AUTH_SECRET || env.JWT_SECRET;
}

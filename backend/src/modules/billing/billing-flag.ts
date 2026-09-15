/**
 * The ONE switch for the entire hosted-billing system (product decision, 2026-09-15). Deliberately
 * named `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`, not `BILLING_ENABLED` or similar — this repo
 * is self-hosted-first (CLAUDE.md), and the whole point of this variable is that a self-hosted
 * operator who copies `.env.example` unmodified must see NOTHING change: no `/api/billing/*` route
 * (`BillingModule` itself is only imported into `AppModule` when this reads `true` — see that
 * module's own header), no settings tab, no banner, no BullMQ lifecycle sweep, no Polar plugin
 * registered on `lib/auth.ts`'s `betterAuth()` instance. Every other file in this feature checks
 * this flag FIRST and is a no-op the moment it is unset — `send-gate.ts#assertCanSend`,
 * `seat-sync.ts#syncCompanySeatsOnMembershipChange` — so a stray import of this module never has a
 * side effect on its own.
 *
 * Pure and synchronous (never throws, never touches Prisma or the network) for the exact reason
 * `lib/sso-policy.ts`'s own functions are: it has to be callable from `lib/auth.ts` at MODULE LOAD
 * TIME (deciding whether to even construct the `polar()` plugin) without that decision itself
 * requiring a live Prisma adapter or an HTTP call.
 *
 * Accepts "true"/"1" case-insensitively, trimmed — the same tolerance `DISABLE_AUTH` already gets
 * (`.env.example`'s own comment on that variable) — so `WARNING__ENABLE_BILLING_FOR_USERS__WARNING=1`
 * and `="True"` both count, and a stray trailing space from a copy-paste never silently reads as
 * "unset".
 */
export const BILLING_FLAG_NAME = 'WARNING__ENABLE_BILLING_FOR_USERS__WARNING';

export function isBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[BILLING_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

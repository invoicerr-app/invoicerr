/**
 * The ONE switch for the entire hosted-billing system (product decision, 2026-09-15). Deliberately
 * named `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`, not `BILLING_ENABLED` or similar — this repo
 * is self-hosted-first (CLAUDE.md), and the whole point of this variable is that a self-hosted
 * operator who copies `.env.example` unmodified must see NOTHING change: no `/api/billing/*` route
 * (`BillingModule` itself is only imported into `AppModule` when this reads `true` — see that
 * module's own header), no settings tab, no banner, no BullMQ lifecycle sweep, no Polar plugin
 * registered on `lib/auth.ts`'s `betterAuth()` instance. Every other file in this feature checks
 * this flag FIRST and is a no-op the moment it is unset — `send-gate.ts#assertCanSend`,
 * `seat-sync.ts#withSeatReservation` — so a stray import of this module never has a
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
import { isDemoModeEnabled } from '@/modules/demo/demo-flag';

export const BILLING_FLAG_NAME = 'WARNING__ENABLE_BILLING_FOR_USERS__WARNING';

/**
 * Demo instance (issue #533) — `DEMO_MODE` overrides this flag outright, in EITHER direction: a demo
 * deployment must never show a paywall, a seat gate, or make a single Polar call, no matter what
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` happens to be set to in that same environment. Checked
 * FIRST, before the billing flag's own read, so every caller of `isBillingEnabled()` — `app.module.ts`
 * (whether `BillingModule`/`CompanyWriteGuard`/`LegalAcceptanceGuard` even enter the graph),
 * `send-gate.ts#assertCanSend`, `lib/auth.ts`'s legal-acceptance-at-signup check — gets this for free,
 * with no separate demo-mode opinion of its own to keep in sync. `getPolarClient()`
 * (`polar-client.ts`) ALSO refuses outright on its own, independently: this is belt-and-suspenders for
 * the one path that does not go through `isBillingEnabled()` first (an instance operator action that
 * still resolves a client directly), not a redundant check for the ordinary one.
 */
export function isBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isDemoModeEnabled(env)) return false;
  const raw = (env[BILLING_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

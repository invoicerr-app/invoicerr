/**
 * Metadata `CompanyWriteGuard` (`company-write.guard.ts`) reads via `Reflector` to let a write
 * through even for a BLOCKED/ZIPPED company — same `SetMetadata` + `getAllAndOverride` shape
 * `@Roles()`/`roles.guard.ts` already holds.
 *
 * Applied to `POST /billing/checkout` and `POST /billing/portal`: they are the ONLY way a blocked
 * company can pay its way back out of `blocked` (a checkout for a new subscription, or a portal
 * session to fix a failed card on an existing one) — gating them the same as every other write would
 * be a permanent, unrecoverable lockout. `write-gate.ts`'s own header used to claim `/api/auth/*`
 * (where Polar's checkout/portal lived before 2026-09-16, mounted by better-auth ahead of Nest's
 * routing layer entirely — see `polar-plugin.ts`'s own git history) already guaranteed this
 * structurally; that stopped being true the moment checkout/portal became real Nest routes
 * (`billing.controller.ts`), which is exactly what makes this explicit decorator necessary now.
 */
import { SetMetadata } from '@nestjs/common';

export const BILLING_GATE_EXEMPT_KEY = 'billing:writeGateExempt';

export const BillingGateExempt = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(BILLING_GATE_EXEMPT_KEY, true);

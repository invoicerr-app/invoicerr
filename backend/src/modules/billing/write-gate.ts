/**
 * The read-only gate (product decision, 2026-09-15): once a company's subscription has fallen into
 * `BLOCKED` or `ZIPPED` (trial expired unpaid, or a paid subscription lapsed — either way `blocked`
 * 14 days, see `lifecycle.ts`'s own header), EVERY write is refused, not just `send`.
 * `send-gate.ts#assertCanSend` already gates the ONE emitting action even during `TRIAL` (a narrower,
 * earlier restriction) — this file is the broader companion for the fully-blocked case, and does not
 * call (or get called from) `assertCanSend`: the two gates check different things off the same row,
 * and a caller past `assertCompanyWritable` may still hit `assertCanSend`'s own narrower refusal on a
 * `send` action specifically (an active-but-still-mid-trial company, e.g.).
 *
 * Applied through ONE generic hook (`CompanyWriteGuard` in `company-write.guard.ts`), a global
 * `APP_GUARD` registered ONLY under the billing flag (`app.module.ts`, same
 * `...(billingEnabled ? [...] : [])` shape `BillingModule` itself uses) — never a call sprinkled into
 * each service, so a new write endpoint is covered automatically rather than by remembering to add one.
 *
 * A no-op when billing is disabled — checked FIRST, same reasoning as `send-gate.ts`'s own header: a
 * self-hosted instance that never sets `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` pays not even one
 * extra Prisma query.
 *
 * ## What the guard around this function exempts, and why (see `company-write.guard.ts`)
 *  - GET/HEAD/OPTIONS — read-only by construction; a blocked company must still be able to see its own
 *    data (the product brief's own "read-only", not "no access").
 *  - Any request with no active company on it (`request.companyId` unset/null) — a route that is not
 *    company-scoped (session/user-level endpoints, `@Public()` routes — which never even reach
 *    `request.companyId` being set, see `guards/auth.guard.ts`) has nothing to gate.
 *  - `/api/auth/*` (session login) never reaches this guard at all: better-auth is mounted as EXPRESS
 *    MIDDLEWARE ahead of Nest's routing layer, responding before any `APP_GUARD` runs. Polar's own
 *    `checkout`/`portal` used to live there too (pre-2026-09-16 — see `polar-plugin.ts`'s own git
 *    history) and got the same free pass; now that they are real Nest routes
 *    (`billing.controller.ts`'s `POST /billing/checkout`/`/billing/portal`) they DO reach this guard,
 *    and are exempted explicitly instead — `@BillingGateExempt()`
 *    (`billing-gate-exempt.decorator.ts`), checked in `company-write.guard.ts`. A blocked company MUST
 *    still be able to reach checkout/portal — that is the only way out of `blocked` — so this is a
 *    real requirement, not a decoration.
 *  - `GET /api/billing/status` and downloading the lifecycle zip (mailed only today, no download
 *    route exists yet — see `export-zip.service.ts`'s own header) are both GETs, already covered by
 *    the GET exemption above; no special case needed for either.
 */
import { ForbiddenException } from '@nestjs/common';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/** Named per the product brief (2026-09-15) — the ONLY code a caller (frontend, API-key integration)
 *  can rely on to mean "this company is blocked; every write is refused, not just sending". */
export const COMPANY_BLOCKED = 'COMPANY_BLOCKED';

/**
 * Throws (403, `{ message, code: COMPANY_BLOCKED }`) when this company's subscription is `BLOCKED` or
 * `ZIPPED`; resolves silently for every other status (including `TRIAL`/`PAST_DUE`/`ACTIVE` — a
 * mid-trial or past-due company can still write everything except `send`, gated separately by
 * `send-gate.ts`). 403, not 402: `send-gate.ts` already answers every subscription refusal in this
 * codebase with `ForbiddenException` (`TRIAL_SEND_BLOCKED`/`SUBSCRIPTION_SEND_BLOCKED`) — one HTTP
 * status for "your subscription forbids this", not a mix a frontend would have to branch on twice.
 */
export async function assertCompanyWritable(companyId: string): Promise<void> {
  if (!isBillingEnabled()) return;

  const sub = await getOrCreateCompanySubscription(companyId);
  if (sub.status !== 'BLOCKED' && sub.status !== 'ZIPPED') return;

  throw new ForbiddenException({
    message:
      'This company is read-only (subscription status "' +
      sub.status +
      '") — every write is refused until it is reactivated. See Settings > Subscription.',
    code: COMPANY_BLOCKED,
  });
}

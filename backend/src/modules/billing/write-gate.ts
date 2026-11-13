/**
 * Refuses every write once a company is `BLOCKED` or `ZIPPED`. Broader companion to
 * `send-gate.ts#assertCanSend`; the two are independent and a caller may still hit the send gate.
 * Applied globally via `CompanyWriteGuard`, so new write endpoints are covered automatically.
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
 *    MIDDLEWARE ahead of Nest's routing layer, responding before any `APP_GUARD` runs. The Stripe
 *    plugin's checkout and portal live there, so a blocked company can always pay its way back out of
 *    `blocked`.
 *  - `GET /api/billing/status` and downloading the lifecycle zip (mailed only today, no download
 *    route exists yet — see `export-zip.service.ts`'s own header) are both GETs, already covered by
 *    the GET exemption above; no special case needed for either.
 */
import { ForbiddenException } from '@nestjs/common';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/** Stable error code clients rely on to mean "every write is refused, not just sending". */
export const COMPANY_BLOCKED = 'COMPANY_BLOCKED';

/** 403 rather than 402 to match every other subscription refusal from `send-gate.ts`. */
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

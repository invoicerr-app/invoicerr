/**
 * Refuses every write once a company is `BLOCKED` or `ZIPPED`. Broader companion to
 * `send-gate.ts#assertCanSend`; the two are independent and a caller may still hit the send gate.
 * Applied globally via `CompanyWriteGuard`, so new write endpoints are covered automatically.
 *
 * Exemptions live in `company-write.guard.ts`: safe methods (a blocked company must still read its
 * data), requests with no active company, and `@BillingGateExempt()` routes (checkout/portal are the
 * only way out of `blocked`). `/api/auth/*` is Express middleware and never reaches the guard.
 */
import { ForbiddenException } from '@nestjs/common';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/** Stable error code clients rely on to mean "every write is refused, not just sending". */
export const COMPANY_BLOCKED = 'COMPANY_BLOCKED';

/** 403 rather than 402 to match every other subscription refusal from `send-gate.ts`. */
export async function assertCompanyWritable(companyId: string): Promise<void> {
  // Checked first so self-hosted instances pay no extra query.
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

/**
 * Gating the `send` action is enough: PDP/Chorus Pro/KSeF deposits and outbound email all happen
 * inside that action's `deliver()` phase, so there is no second call site.
 */
import { ForbiddenException } from '@nestjs/common';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/** Stable code clients rely on to mean "in trial; sending is the one thing trial does not allow". */
export const TRIAL_SEND_BLOCKED = 'TRIAL_SEND_BLOCKED';
/** Code for every non-trial status that forbids sending (BLOCKED/ZIPPED/DELETED/PAST_DUE). */
export const SUBSCRIPTION_SEND_BLOCKED = 'SUBSCRIPTION_SEND_BLOCKED';

/** Throws a 403 `{ message, code }` unless billing is disabled or the subscription is `ACTIVE`. */
export async function assertCanSend(companyId: string): Promise<void> {
  // Checked first so self-hosted instances pay no extra query on this hot path.
  if (!isBillingEnabled()) return;

  const sub = await getOrCreateCompanySubscription(companyId);

  if (sub.status === 'ACTIVE') return;

  if (sub.status === 'TRIAL') {
    throw new ForbiddenException({
      message:
        'This company is still on its 14-day trial — every other action works, but sending a ' +
        'document (email, PDP/Chorus Pro/KSeF deposit…) requires an active subscription first.',
      code: TRIAL_SEND_BLOCKED,
    });
  }

  throw new ForbiddenException({
    message:
      'This company\'s subscription is not active (status "' +
      sub.status +
      '") — sending is disabled. See Settings > Subscription.',
    code: SUBSCRIPTION_SEND_BLOCKED,
  });
}

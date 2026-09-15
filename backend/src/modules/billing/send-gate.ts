/**
 * The emission gate — `documents.service.ts#runAction` calls `assertCanSend` at the exact point it
 * already recognizes an emitting action (`actionId === 'send'`, the SAME literal every document type
 * that has one uses — quote/invoice/credit-note, see `actions/async-send.ts`'s own header: "the
 * two-phase send every type declaring one shares"). PDP/Chorus Pro/KSeF deposits and the actual
 * outbound email are never a SEPARATE action of their own — they happen INSIDE that one `send`
 * action's `deliver()` phase (`async-send.ts`), so gating `send` itself is what gates all of them at
 * once; there is no second call site to find.
 *
 * A no-op when billing is disabled — checked FIRST, before anything else, so a self-hosted instance
 * that never sets `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` pays not even one extra Prisma query
 * on its hottest write path (`documents.service.ts`'s own `runAction` gates every single action).
 */
import { ForbiddenException } from '@nestjs/common';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/** Named per the product brief — the ONLY code a caller (the frontend, an API-key integration) can
 *  rely on to mean "you are in trial; sending is the one thing trial does not allow". */
export const TRIAL_SEND_BLOCKED = 'TRIAL_SEND_BLOCKED';
/** A broader companion code for every OTHER status that also forbids sending (BLOCKED/ZIPPED/
 *  DELETED/PAST_DUE) — not itself named by the product brief (which only named the trial case), but
 *  the same gate function is the only sane place to also refuse these, since a blocked/zipped company
 *  has strictly LESS access than a trialing one, never more. */
export const SUBSCRIPTION_SEND_BLOCKED = 'SUBSCRIPTION_SEND_BLOCKED';

/**
 * Throws (403, `{ message, code }`) when this company's subscription forbids sending; resolves
 * silently otherwise. `ACTIVE` is the only status that ever passes once billing is enabled — every
 * other status is either mid-trial (send is the one thing withheld) or already past it
 * (TRIAL_SEND_BLOCKED)/blocked outright (SUBSCRIPTION_SEND_BLOCKED).
 */
export async function assertCanSend(companyId: string): Promise<void> {
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

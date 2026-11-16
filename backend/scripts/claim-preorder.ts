/**
 * `npm run billing:claim-preorder -- <preorderId> <companyId>` (#760): attaches a paid founder
 * pre-order to a company (`src/modules/billing/founder-preorder.ts`). The company gets the founder grid
 * and a founder subscription on its Stripe customer whose first period, already paid, runs from
 * `BILLING_OPENING_DATE` for the interval bought. Run through `tsx`, like `grant-founder.ts`.
 *
 * Exits non-zero when nothing was claimed.
 */
import 'dotenv/config';

import { claimFounderPreorder } from '../src/modules/billing/founder-preorder';
import prisma from '../src/prisma/prisma.service';

const REFUSALS = {
  no_preorder: 'No pre-order with this id.',
  already_claimed: 'This pre-order was already claimed.',
  no_company: 'No company with this id.',
  already_subscribed:
    'This company already has a live subscription; cancel it first or refund the pre-order.',
  lost: 'This company lost the founder grid after an interruption; the pre-order cannot give it back.',
  customer_in_use: "The pre-order's Stripe customer already bills another company.",
} as const;

async function main(): Promise<number> {
  const preorderId = (process.argv[2] ?? '').trim();
  const companyId = (process.argv[3] ?? '').trim();
  if (preorderId === '' || companyId === '') {
    console.error('Usage: npm run billing:claim-preorder -- <preorderId> <companyId>');
    return 2;
  }
  const result = await claimFounderPreorder(preorderId, companyId);
  if (result.outcome !== 'claimed') {
    console.error(REFUSALS[result.outcome]);
    return 1;
  }
  const until = result.prepaidUntil
    ? `prepaid until ${result.prepaidUntil.toISOString()}`
    : 'billed from now on';
  console.log(`Pre-order claimed: Stripe subscription ${result.stripeSubscriptionId}, ${until}.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

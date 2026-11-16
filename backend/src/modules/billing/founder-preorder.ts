/**
 * Founder pre-orders (#760, #971 slice 8): a subscription paid in advance, before the hosted service
 * opens. Its prepaid period starts at the opening date (`BILLING_OPENING_DATE`), then the subscription
 * renews on the founder grid, which the company receives on its own when it claims the pre-order.
 *
 * 1. Paying: a one-off Stripe Checkout payment (mode `payment`) carrying the metadata
 *    `invoicerr_preorder = founder`, `seats` and `interval` (`monthly` or `yearly`), with a Stripe
 *    customer attached. How that session is created (a Payment Link, the public site) is outside this
 *    module.
 * 2. Recording: the Stripe webhook (`stripe-plugin.ts`, `onEvent`) stores one `FounderPreorder` row per
 *    paid session, idempotently. A failed write throws, so Stripe retries the event.
 * 3. Claiming: once the buyer's company exists, the operator runs
 *    `npm run billing:claim-preorder -- <preorderId> <companyId>`. The company gets the founder grid
 *    and a founder subscription on its Stripe customer, quantity = the seats paid for, in trial until
 *    `opening + interval` so the period already paid is not charged again. Stripe then sends
 *    `customer.subscription.created`, which the plugin mirrors and `stripe-subscription-sync.ts` turns
 *    into an ACTIVE company paid through the end of that period.
 */
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

import { grantFounderGrid } from './founder-grid';
import { stripeClientFor } from './stripe-client';
import { type BillingInterval, readStripePriceCatalog } from './stripe-price-catalog';

export const PREORDER_METADATA_KEY = 'invoicerr_preorder';
export const FOUNDER_PREORDER = 'founder';

const PAID_SESSION_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);
const INTERVALS = new Set<string>(['monthly', 'yearly']);

/** The fields of a Stripe Checkout session this module reads. */
export interface PreorderCheckoutSession {
  id: string;
  mode?: string | null;
  payment_status?: string | null;
  customer?: string | { id: string } | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
}

export interface FounderPreorderRecord {
  stripeCheckoutSessionId: string;
  stripeCustomerId: string;
  email: string;
  seats: number;
  interval: BillingInterval;
}

export type ParsedPreorderSession =
  | { kind: 'not_a_preorder' }
  | { kind: 'unpaid' }
  | { kind: 'invalid'; problem: string }
  | { kind: 'preorder'; record: FounderPreorderRecord };

export function parseFounderPreorderSession(session: PreorderCheckoutSession): ParsedPreorderSession {
  if (session.mode !== 'payment' || session.metadata?.[PREORDER_METADATA_KEY] !== FOUNDER_PREORDER) {
    return { kind: 'not_a_preorder' };
  }
  if (session.payment_status !== 'paid') return { kind: 'unpaid' };

  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customer) return { kind: 'invalid', problem: 'no Stripe customer on the session' };
  const email = (session.customer_details?.email ?? session.customer_email ?? '').trim().toLowerCase();
  if (email === '') return { kind: 'invalid', problem: 'no buyer email on the session' };
  const seats = Number(session.metadata?.seats);
  if (!Number.isInteger(seats) || seats < 1)
    return { kind: 'invalid', problem: 'metadata seats is not a positive integer' };
  const interval = session.metadata?.interval ?? '';
  if (!INTERVALS.has(interval))
    return { kind: 'invalid', problem: 'metadata interval is not monthly or yearly' };

  return {
    kind: 'preorder',
    record: {
      stripeCheckoutSessionId: session.id,
      stripeCustomerId: customer,
      email,
      seats,
      interval: interval as BillingInterval,
    },
  };
}

/** The fields of a Stripe webhook event this module reads. */
export interface PreorderWebhookEvent {
  type: string;
  created: number;
  data: { object: unknown };
}

export type RecordPreorderOutcome = 'ignored' | 'recorded' | 'invalid';

/**
 * Called for every Stripe webhook event. Records a paid founder pre-order session once; replays and
 * the `async_payment_succeeded` event following a `completed` one land on the same row.
 */
export async function recordFounderPreorderEvent(
  event: PreorderWebhookEvent,
): Promise<RecordPreorderOutcome> {
  if (!PAID_SESSION_EVENTS.has(event.type)) return 'ignored';
  const session = event.data.object as PreorderCheckoutSession;
  const parsed = parseFounderPreorderSession(session);
  if (parsed.kind === 'not_a_preorder' || parsed.kind === 'unpaid') return 'ignored';
  if (parsed.kind === 'invalid') {
    // Paid but unusable: logged for the operator, who refunds or records it by hand. Not thrown, a
    // Stripe retry would carry the same session.
    logger.error('A paid founder pre-order session cannot be recorded', {
      category: 'billing',
      details: { sessionId: session.id, problem: parsed.problem },
    });
    return 'invalid';
  }
  await prisma.founderPreorder.upsert({
    where: { stripeCheckoutSessionId: parsed.record.stripeCheckoutSessionId },
    create: { ...parsed.record, paidAt: new Date(event.created * 1000) },
    update: {},
  });
  return 'recorded';
}

/** `BILLING_OPENING_DATE`: the day the hosted service opens, start of every prepaid period. */
export function readOpeningDate(env: NodeJS.ProcessEnv = process.env): Date {
  const raw = (env.BILLING_OPENING_DATE ?? '').trim();
  const date = new Date(raw);
  if (raw === '' || Number.isNaN(date.getTime())) {
    throw new Error('[billing] BILLING_OPENING_DATE is not set to a date (YYYY-MM-DD)');
  }
  return date;
}

export function addInterval(from: Date, interval: BillingInterval): Date {
  const to = new Date(from);
  if (interval === 'yearly') to.setUTCFullYear(to.getUTCFullYear() + 1);
  else to.setUTCMonth(to.getUTCMonth() + 1);
  return to;
}

/**
 * When the prepaid period ends, as a Stripe trial end: `opening + interval`. `null` once that moment
 * is less than an hour away (a pre-order claimed after its prepaid period): billing starts now.
 */
export function prepaidPeriodEnd(opening: Date, interval: BillingInterval, now: Date): Date | null {
  const end = addInterval(opening, interval);
  return end.getTime() - now.getTime() > 60 * 60 * 1000 ? end : null;
}

export interface CreatePreorderSubscriptionParams {
  customer: string;
  items: { price: string; quantity: number }[];
  trial_end?: number;
  metadata: Record<string, string>;
}

/** The one Stripe call claiming makes, typed narrowly so a spec can pass a fake. */
export interface PreorderStripeApi {
  createSubscription(
    params: CreatePreorderSubscriptionParams,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}

const stripeApi = (env: NodeJS.ProcessEnv): PreorderStripeApi => ({
  createSubscription: (params, idempotencyKey) =>
    stripeClientFor(env).subscriptions.create(params, { idempotencyKey }),
});

// A subscription Stripe still bills, or may bill again: claiming on top of it would charge twice.
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];

export type ClaimPreorderResult =
  | { outcome: 'claimed'; stripeSubscriptionId: string; prepaidUntil: Date | null }
  | {
      outcome:
        | 'no_preorder'
        | 'already_claimed'
        | 'no_company'
        | 'already_subscribed'
        | 'lost'
        | 'customer_in_use';
    };

export async function claimFounderPreorder(
  preorderId: string,
  companyId: string,
  {
    now = new Date(),
    env = process.env,
    api,
  }: { now?: Date; env?: NodeJS.ProcessEnv; api?: PreorderStripeApi } = {},
): Promise<ClaimPreorderResult> {
  const preorder = await prisma.founderPreorder.findUnique({ where: { id: preorderId } });
  if (!preorder) return { outcome: 'no_preorder' };
  if (preorder.claimedAt !== null) return { outcome: 'already_claimed' };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!company) return { outcome: 'no_company' };

  const live = await prisma.subscription.findFirst({
    where: { referenceId: companyId, status: { in: LIVE_STATUSES } },
    select: { id: true },
  });
  if (live) return { outcome: 'already_subscribed' };

  // Configuration problems throw before anything is written.
  const opening = readOpeningDate(env);
  const founderPrices = readStripePriceCatalog(env).founder;
  if (!founderPrices) throw new Error('[billing] The founder prices (STRIPE_PRICE_FOUNDER_*) are not set');
  const interval = preorder.interval as BillingInterval;
  if (!INTERVALS.has(interval)) throw new Error(`[billing] Pre-order ${preorder.id} has an unknown interval`);

  // A company keeps the Stripe customer it already has. One without gets the pre-order's own, unless
  // another company already bills to it.
  let customer = company.stripeCustomerId;
  if (customer === null) {
    const taken = await prisma.company.findFirst({
      where: { stripeCustomerId: preorder.stripeCustomerId, id: { not: companyId } },
      select: { id: true },
    });
    if (taken) return { outcome: 'customer_in_use' };
  }

  const grant = await grantFounderGrid(companyId, now);
  if (grant === 'lost') return { outcome: 'lost' };
  if (grant === 'no_company') return { outcome: 'no_company' };

  if (customer === null) {
    await prisma.company.updateMany({
      where: { id: companyId, stripeCustomerId: null },
      data: { stripeCustomerId: preorder.stripeCustomerId },
    });
    const fresh = await prisma.company.findUnique({
      where: { id: companyId },
      select: { stripeCustomerId: true },
    });
    customer = fresh?.stripeCustomerId ?? preorder.stripeCustomerId;
  }

  const prepaidUntil = prepaidPeriodEnd(opening, interval, now);
  // Same key on a re-run (a crash between Stripe and the row update): Stripe returns the subscription
  // it already created instead of a second one, for 24 hours.
  const subscription = await (api ?? stripeApi(env)).createSubscription(
    {
      customer,
      items: [{ price: founderPrices[interval], quantity: preorder.seats }],
      ...(prepaidUntil ? { trial_end: Math.floor(prepaidUntil.getTime() / 1000) } : {}),
      metadata: { referenceId: companyId, founderPreorderId: preorder.id },
    },
    `founder-preorder-${preorder.id}`,
  );

  const { count } = await prisma.founderPreorder.updateMany({
    where: { id: preorder.id, claimedAt: null },
    data: { claimedByCompanyId: companyId, claimedAt: now, stripeSubscriptionId: subscription.id },
  });
  if (count === 0) return { outcome: 'already_claimed' };
  return { outcome: 'claimed', stripeSubscriptionId: subscription.id, prepaidUntil };
}

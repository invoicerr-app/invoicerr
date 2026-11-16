import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

import { grantFounderGrid } from './founder-grid';
import {
  addInterval,
  claimFounderPreorder,
  parseFounderPreorderSession,
  type PreorderCheckoutSession,
  type PreorderStripeApi,
  prepaidPeriodEnd,
  readOpeningDate,
  recordFounderPreorderEvent,
} from './founder-preorder';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    founderPreorder: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    company: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    subscription: { findFirst: vi.fn() },
  },
}));
vi.mock('@/logger/logger.service', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./founder-grid', () => ({ grantFounderGrid: vi.fn() }));

const NOW = new Date('2027-01-10T12:00:00.000Z');
const ENV = {
  BILLING_OPENING_DATE: '2027-02-01',
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_sm',
  STRIPE_PRICE_STANDARD_YEARLY: 'price_sy',
  STRIPE_PRICE_FOUNDER_MONTHLY: 'price_fm',
  STRIPE_PRICE_FOUNDER_YEARLY: 'price_fy',
} as NodeJS.ProcessEnv;

const paidSession = (over: Partial<PreorderCheckoutSession> = {}): PreorderCheckoutSession => ({
  id: 'cs_1',
  mode: 'payment',
  payment_status: 'paid',
  customer: 'cus_buyer',
  customer_details: { email: 'Buyer@Example.com ' },
  metadata: { invoicerr_preorder: 'founder', seats: '3', interval: 'yearly' },
  ...over,
});

afterEach(() => vi.resetAllMocks());

describe('reading a pre-order checkout session', () => {
  it('reads a paid founder pre-order', () => {
    expect(parseFounderPreorderSession(paidSession())).toEqual({
      kind: 'preorder',
      record: {
        stripeCheckoutSessionId: 'cs_1',
        stripeCustomerId: 'cus_buyer',
        email: 'buyer@example.com',
        seats: 3,
        interval: 'yearly',
      },
    });
  });

  it('ignores subscription checkouts and payments without the pre-order marker', () => {
    expect(parseFounderPreorderSession(paidSession({ mode: 'subscription' })).kind).toBe('not_a_preorder');
    expect(
      parseFounderPreorderSession(paidSession({ metadata: { seats: '3', interval: 'yearly' } })).kind,
    ).toBe('not_a_preorder');
  });

  it('waits for a delayed payment to succeed', () => {
    expect(parseFounderPreorderSession(paidSession({ payment_status: 'unpaid' })).kind).toBe('unpaid');
  });

  it.each([
    [{ customer: null }, 'no Stripe customer on the session'],
    [{ customer_details: { email: null }, customer_email: null }, 'no buyer email on the session'],
    [
      { metadata: { invoicerr_preorder: 'founder', seats: '0', interval: 'yearly' } },
      'metadata seats is not a positive integer',
    ],
    [
      { metadata: { invoicerr_preorder: 'founder', seats: '2.5', interval: 'yearly' } },
      'metadata seats is not a positive integer',
    ],
    [
      { metadata: { invoicerr_preorder: 'founder', seats: '2', interval: 'weekly' } },
      'metadata interval is not monthly or yearly',
    ],
  ])('refuses an unusable paid session (%o)', (over, problem) => {
    expect(parseFounderPreorderSession(paidSession(over))).toEqual({ kind: 'invalid', problem });
  });

  it('reads an expanded customer and falls back to the session email', () => {
    const parsed = parseFounderPreorderSession(
      paidSession({ customer: { id: 'cus_x' }, customer_details: null, customer_email: 'a@b.c' }),
    );
    expect(parsed).toMatchObject({ kind: 'preorder', record: { stripeCustomerId: 'cus_x', email: 'a@b.c' } });
  });
});

describe('recording a pre-order from the Stripe webhook', () => {
  const event = (type: string, session = paidSession()) => ({
    type,
    created: 1_800_000_000,
    data: { object: session },
  });

  it.each([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
  ])('records a paid session once, keyed by its id (%s)', async (type) => {
    expect(await recordFounderPreorderEvent(event(type))).toBe('recorded');
    expect(prisma.founderPreorder.upsert).toHaveBeenCalledWith({
      where: { stripeCheckoutSessionId: 'cs_1' },
      create: {
        stripeCheckoutSessionId: 'cs_1',
        stripeCustomerId: 'cus_buyer',
        email: 'buyer@example.com',
        seats: 3,
        interval: 'yearly',
        paidAt: new Date(1_800_000_000 * 1000),
      },
      update: {},
    });
  });

  it('ignores other events and sessions that are not paid pre-orders', async () => {
    expect(await recordFounderPreorderEvent(event('customer.subscription.updated'))).toBe('ignored');
    expect(
      await recordFounderPreorderEvent(
        event('checkout.session.completed', paidSession({ mode: 'subscription' })),
      ),
    ).toBe('ignored');
    expect(
      await recordFounderPreorderEvent(
        event('checkout.session.completed', paidSession({ payment_status: 'unpaid' })),
      ),
    ).toBe('ignored');
    expect(prisma.founderPreorder.upsert).not.toHaveBeenCalled();
  });

  it('logs an unusable paid session for the operator without failing the webhook', async () => {
    expect(
      await recordFounderPreorderEvent(event('checkout.session.completed', paidSession({ customer: null }))),
    ).toBe('invalid');
    expect(logger.error).toHaveBeenCalled();
    expect(prisma.founderPreorder.upsert).not.toHaveBeenCalled();
  });

  it('lets a database failure through, so Stripe retries the event', async () => {
    (prisma.founderPreorder.upsert as Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(recordFounderPreorderEvent(event('checkout.session.completed'))).rejects.toThrow('db down');
  });
});

describe('the prepaid period', () => {
  it('reads the opening date and refuses a missing or broken one', () => {
    expect(readOpeningDate(ENV).toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(() => readOpeningDate({})).toThrow('BILLING_OPENING_DATE');
    expect(() => readOpeningDate({ BILLING_OPENING_DATE: 'soon' })).toThrow('BILLING_OPENING_DATE');
  });

  it('lasts one interval from the opening date', () => {
    const opening = new Date('2027-02-01T00:00:00.000Z');
    expect(addInterval(opening, 'monthly').toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(addInterval(opening, 'yearly').toISOString()).toBe('2028-02-01T00:00:00.000Z');
    expect(prepaidPeriodEnd(opening, 'monthly', NOW)?.toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('is over for a pre-order claimed after it: billing starts now', () => {
    const opening = new Date('2027-02-01T00:00:00.000Z');
    expect(prepaidPeriodEnd(opening, 'monthly', new Date('2027-03-05T00:00:00.000Z'))).toBeNull();
    expect(prepaidPeriodEnd(opening, 'monthly', new Date('2027-02-28T23:30:00.000Z'))).toBeNull();
  });
});

describe('claiming a pre-order for a company', () => {
  const preorder = {
    id: 'po_1',
    stripeCustomerId: 'cus_buyer',
    seats: 3,
    interval: 'yearly',
    claimedAt: null,
  };
  let api: PreorderStripeApi & { createSubscription: Mock };

  beforeEach(() => {
    api = { createSubscription: vi.fn().mockResolvedValue({ id: 'sub_new' }) };
    (prisma.founderPreorder.findUnique as Mock).mockResolvedValue(preorder);
    (prisma.company.findUnique as Mock).mockResolvedValue({ id: 'c1', stripeCustomerId: 'cus_company' });
    (prisma.subscription.findFirst as Mock).mockResolvedValue(null);
    (prisma.company.findFirst as Mock).mockResolvedValue(null);
    (prisma.founderPreorder.updateMany as Mock).mockResolvedValue({ count: 1 });
    (grantFounderGrid as Mock).mockResolvedValue('granted');
  });

  const claim = () => claimFounderPreorder('po_1', 'c1', { now: NOW, env: ENV, api });

  it('grants the founder grid and subscribes the company on founder, prepaid until opening + interval', async () => {
    expect(await claim()).toEqual({
      outcome: 'claimed',
      stripeSubscriptionId: 'sub_new',
      prepaidUntil: new Date('2028-02-01T00:00:00.000Z'),
    });
    expect(grantFounderGrid).toHaveBeenCalledWith('c1', NOW);
    expect(api.createSubscription).toHaveBeenCalledWith(
      {
        customer: 'cus_company',
        items: [{ price: 'price_fy', quantity: 3 }],
        trial_end: Date.parse('2028-02-01T00:00:00.000Z') / 1000,
        metadata: { referenceId: 'c1', founderPreorderId: 'po_1' },
      },
      'founder-preorder-po_1',
    );
    expect(prisma.founderPreorder.updateMany).toHaveBeenCalledWith({
      where: { id: 'po_1', claimedAt: null },
      data: { claimedByCompanyId: 'c1', claimedAt: NOW, stripeSubscriptionId: 'sub_new' },
    });
  });

  it("gives a company without a Stripe customer the pre-order's own", async () => {
    (prisma.company.findUnique as Mock)
      .mockResolvedValueOnce({ id: 'c1', stripeCustomerId: null })
      .mockResolvedValueOnce({ stripeCustomerId: 'cus_buyer' });
    await claim();
    expect(prisma.company.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', stripeCustomerId: null },
      data: { stripeCustomerId: 'cus_buyer' },
    });
    expect(api.createSubscription.mock.calls[0][0].customer).toBe('cus_buyer');
  });

  it('starts billing now for a pre-order claimed after its prepaid period', async () => {
    (prisma.founderPreorder.findUnique as Mock).mockResolvedValue({ ...preorder, interval: 'monthly' });
    const result = await claimFounderPreorder('po_1', 'c1', {
      now: new Date('2027-04-01T00:00:00.000Z'),
      env: ENV,
      api,
    });
    expect(result).toMatchObject({ outcome: 'claimed', prepaidUntil: null });
    expect(api.createSubscription.mock.calls[0][0]).not.toHaveProperty('trial_end');
    expect(api.createSubscription.mock.calls[0][0].items).toEqual([{ price: 'price_fm', quantity: 3 }]);
  });

  it.each([
    ['no_preorder', () => (prisma.founderPreorder.findUnique as Mock).mockResolvedValue(null)],
    [
      'already_claimed',
      () => (prisma.founderPreorder.findUnique as Mock).mockResolvedValue({ ...preorder, claimedAt: NOW }),
    ],
    ['no_company', () => (prisma.company.findUnique as Mock).mockResolvedValue(null)],
    ['already_subscribed', () => (prisma.subscription.findFirst as Mock).mockResolvedValue({ id: 's1' })],
    ['lost', () => (grantFounderGrid as Mock).mockResolvedValue('lost')],
    [
      'customer_in_use',
      () => {
        (prisma.company.findUnique as Mock).mockResolvedValue({ id: 'c1', stripeCustomerId: null });
        (prisma.company.findFirst as Mock).mockResolvedValue({ id: 'c2' });
      },
    ],
  ])('refuses without charging anything: %s', async (outcome, arrange) => {
    arrange();
    expect(await claim()).toEqual({ outcome });
    expect(api.createSubscription).not.toHaveBeenCalled();
    expect(prisma.founderPreorder.updateMany).not.toHaveBeenCalled();
  });

  it('reports a concurrent claim that marked the pre-order first', async () => {
    (prisma.founderPreorder.updateMany as Mock).mockResolvedValue({ count: 0 });
    expect(await claim()).toEqual({ outcome: 'already_claimed' });
  });

  it('throws on a missing opening date or founder prices before granting anything', async () => {
    await expect(
      claimFounderPreorder('po_1', 'c1', { now: NOW, env: { ...ENV, BILLING_OPENING_DATE: '' }, api }),
    ).rejects.toThrow('BILLING_OPENING_DATE');
    const noFounder = { ...ENV, STRIPE_PRICE_FOUNDER_MONTHLY: '', STRIPE_PRICE_FOUNDER_YEARLY: '' };
    await expect(claimFounderPreorder('po_1', 'c1', { now: NOW, env: noFounder, api })).rejects.toThrow(
      'founder prices',
    );
    expect(grantFounderGrid).not.toHaveBeenCalled();
    expect(api.createSubscription).not.toHaveBeenCalled();
  });
});

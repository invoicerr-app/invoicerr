import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import {
  applyStripeSubscriptionFacts,
  mapStripeInterval,
  mapStripeSubscriptionStatus,
  type StripeSubscriptionFacts,
  syncStripeSubscription,
  toStripeSubscriptionFacts,
} from './stripe-subscription-sync';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    subscription: { findFirst: vi.fn() },
    companySubscription: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const NOW = new Date('2026-11-13T12:00:00.000Z');
const FACT_AT = new Date('2026-11-13T11:00:00.000Z');
const PERIOD_END = new Date('2026-12-13T11:00:00.000Z');

const update = prisma.companySubscription.update as Mock;

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'c1',
    status: 'TRIAL',
    trialEndsAt: new Date('2026-11-01T00:00:00.000Z'), // trial already over at NOW
    firstPaidAt: null,
    lastBillingFactAt: null,
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    ...overrides,
  };
}

function facts(overrides: Partial<StripeSubscriptionFacts> = {}): StripeSubscriptionFacts {
  return {
    companyId: 'c1',
    pluginSubscriptionId: 'ps1',
    status: 'ACTIVE',
    seats: 3,
    interval: 'YEAR',
    currentPeriodEnd: PERIOD_END,
    factAt: FACT_AT,
    ...overrides,
  };
}

function arrange(row: ReturnType<typeof subRow> | null, { companyExists = true, otherPaid = false } = {}) {
  (prisma.company.findUnique as Mock).mockResolvedValue(companyExists ? { id: 'c1' } : null);
  (prisma.subscription.findFirst as Mock).mockResolvedValue(otherPaid ? { id: 'ps2' } : null);
  (prisma.companySubscription.findUnique as Mock).mockResolvedValue(row);
  (prisma.companySubscription.findUniqueOrThrow as Mock).mockResolvedValue(row);
  (prisma.$transaction as Mock).mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
}

afterEach(() => vi.resetAllMocks());

describe('mapping', () => {
  it.each([
    ['active', 'ACTIVE'],
    ['trialing', 'ACTIVE'],
    ['past_due', 'PAST_DUE'],
    ['unpaid', 'PAST_DUE'],
    ['canceled', 'PAST_DUE'],
    ['incomplete', 'PAST_DUE'],
    ['incomplete_expired', 'PAST_DUE'],
    ['paused', 'PAST_DUE'],
  ])('maps Stripe %s to %s', (stripe, mapped) => {
    expect(mapStripeSubscriptionStatus(stripe)).toBe(mapped);
  });

  it('maps the billing interval, and nothing else', () => {
    expect(mapStripeInterval('month')).toBe('MONTH');
    expect(mapStripeInterval('year')).toBe('YEAR');
    expect(mapStripeInterval('week')).toBeUndefined();
    expect(mapStripeInterval(undefined)).toBeUndefined();
  });

  it('reads company, seats, interval, period end and the event time from a hook call', () => {
    expect(
      toStripeSubscriptionFacts({
        event: { created: FACT_AT.getTime() / 1000 },
        subscription: {
          id: 'ps1',
          referenceId: 'c1',
          status: 'active',
          seats: 4,
          billingInterval: 'month',
          periodEnd: PERIOD_END,
        },
      }),
    ).toEqual({
      companyId: 'c1',
      pluginSubscriptionId: 'ps1',
      status: 'ACTIVE',
      seats: 4,
      interval: 'MONTH',
      currentPeriodEnd: PERIOD_END,
      factAt: FACT_AT,
    });
  });

  it('never takes a seat count below one', () => {
    const data = (seats: number | null) => ({
      event: { created: 0 },
      subscription: { id: 'ps1', referenceId: 'c1', status: 'active', seats },
    });
    expect(toStripeSubscriptionFacts(data(0)).seats).toBeUndefined();
    expect(toStripeSubscriptionFacts(data(null)).seats).toBeUndefined();
  });
});

describe('applyStripeSubscriptionFacts', () => {
  it('moves a company to ACTIVE with its seats, interval, period end, first payment and watermark', async () => {
    arrange(subRow());

    expect(await applyStripeSubscriptionFacts(facts(), NOW)).toBe('applied');

    expect(prisma.$queryRaw).toHaveBeenCalled(); // row lock
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: {
        status: 'ACTIVE',
        lastBillingFactAt: FACT_AT,
        seats: 3,
        interval: 'YEAR',
        currentPeriodEnd: PERIOD_END,
        firstPaidAt: FACT_AT,
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
      },
    });
  });

  it('pulls a BLOCKED or ZIPPED company out of the suspension and deletion clocks once it pays', async () => {
    const paidBefore = new Date('2026-01-01T00:00:00.000Z');
    arrange(
      subRow({
        status: 'ZIPPED',
        firstPaidAt: paidBefore,
        blockedAt: new Date('2026-10-01T00:00:00.000Z'),
        zipSentAt: new Date('2026-10-15T00:00:00.000Z'),
        deletionDueAt: new Date('2027-04-13T00:00:00.000Z'),
      }),
    );

    await applyStripeSubscriptionFacts(facts(), NOW);

    const { data } = update.mock.calls[0][0];
    expect(data).toMatchObject({ status: 'ACTIVE', blockedAt: null, zipSentAt: null, deletionDueAt: null });
    expect(data).not.toHaveProperty('firstPaidAt'); // never overwritten
  });

  it('moves a paying company out of ACTIVE without touching its paid period or first payment', async () => {
    const paidBefore = new Date('2026-01-01T00:00:00.000Z');
    arrange(subRow({ status: 'ACTIVE', firstPaidAt: paidBefore }));

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE', seats: 2 }), NOW)).toBe('applied');

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: { status: 'PAST_DUE', lastBillingFactAt: FACT_AT, seats: 2, interval: 'YEAR' },
    });
  });

  it('drops a fact older than the last one applied', async () => {
    arrange(subRow({ status: 'PAST_DUE', lastBillingFactAt: new Date(FACT_AT.getTime() + 1000) }));

    expect(await applyStripeSubscriptionFacts(facts(), NOW)).toBe('stale');
    expect(update).not.toHaveBeenCalled();
  });

  it('applies a fact from the same second as the last one', async () => {
    arrange(subRow({ status: 'ACTIVE', lastBillingFactAt: FACT_AT }));

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('applied');
  });

  it('never cuts a still-valid trial short on an abandoned checkout, and plants no watermark', async () => {
    arrange(subRow({ status: 'TRIAL', trialEndsAt: new Date('2026-11-20T00:00:00.000Z') }));

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('held_back');
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['BLOCKED', 'ZIPPED'])('never walks a %s company back to PAST_DUE', async (status) => {
    arrange(subRow({ status }));

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('held_back');
    expect(update).not.toHaveBeenCalled();
  });

  it('moves a company whose trial is over to PAST_DUE on an unpaid subscription', async () => {
    arrange(subRow({ status: 'TRIAL' }));

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('applied');
  });

  it('ignores an old subscription ending while the company has another one that is paid', async () => {
    arrange(subRow({ status: 'ACTIVE' }), { otherPaid: true });

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('held_back');
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { referenceId: 'c1', id: { not: 'ps1' }, status: { in: ['active', 'trialing'] } },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores a company that no longer exists', async () => {
    arrange(null, { companyExists: false });

    expect(await applyStripeSubscriptionFacts(facts({ status: 'PAST_DUE' }), NOW)).toBe('no_company');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('syncStripeSubscription', () => {
  it('maps a plugin hook call and applies it', async () => {
    arrange(subRow());

    const outcome = await syncStripeSubscription({
      event: { created: FACT_AT.getTime() / 1000 },
      subscription: { id: 'ps1', referenceId: 'c1', status: 'trialing', seats: 5, billingInterval: 'month' },
    });

    expect(outcome).toBe('applied');
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', seats: 5, interval: 'MONTH' });
  });
});

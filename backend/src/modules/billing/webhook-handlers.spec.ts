import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import {
  getOrCreateCompanySubscription,
  recomputeStatusForVanishedSubscription,
} from './company-subscription.store';
import {
  applySubscriptionWebhook,
  handleSubscriptionPayload,
  mapPolarRecurringInterval,
  mapPolarSubscriptionStatus,
} from './webhook-handlers';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: { update: vi.fn(), findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));
vi.mock('./company-subscription.store');

const update = prisma.companySubscription.update as Mock;
const findLegacyRow = prisma.companySubscription.findFirst as Mock;
const findCompany = prisma.company.findUnique as Mock;
const getOrCreate = getOrCreateCompanySubscription as Mock;
const recomputeVanished = recomputeStatusForVanishedSubscription as Mock;

describe('mapPolarSubscriptionStatus', () => {
  it.each(['active', 'trialing'])('%s maps to ACTIVE', (status) => {
    expect(mapPolarSubscriptionStatus(status)).toBe('ACTIVE');
  });

  it.each([
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ])('%s maps to PAST_DUE', (status) => {
    expect(mapPolarSubscriptionStatus(status)).toBe('PAST_DUE');
  });
});

describe('mapPolarRecurringInterval', () => {
  it('maps month/year, and null for anything else', () => {
    expect(mapPolarRecurringInterval('month')).toBe('MONTH');
    expect(mapPolarRecurringInterval('year')).toBe('YEAR');
    expect(mapPolarRecurringInterval('week')).toBeNull();
    expect(mapPolarRecurringInterval('day')).toBeNull();
  });
});

describe('applySubscriptionWebhook', () => {
  beforeEach(() => {
    // The common case: the resolved companyId is a real, still-existing company. Tests for the
    // opposite override this per-case.
    findCompany.mockResolvedValue({ id: 'company-1' });
  });
  afterEach(() => vi.resetAllMocks());

  it('lazily ensures the row exists, then writes status/ids/interval', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'ACTIVE',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        interval: 'MONTH',
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        seatPaymentFailedAt: null,
      },
    });
  });

  it('writes the seats field when the webhook carries one — the only direction seat quantity ever flows in', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      seats: 4,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seats: 4 }) }),
    );
  });

  it('writes currentPeriodEnd when the webhook carries one — the fact the paid-period Terms exception reads', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });
    const currentPeriodEnd = new Date('2026-10-18T00:00:00.000Z');

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      currentPeriodEnd,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentPeriodEnd }) }),
    );
  });

  it('leaves the stored currentPeriodEnd untouched when the webhook carries none', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ currentPeriodEnd: expect.anything() }),
      }),
    );
  });

  it('never mirrors a currentPeriodEnd carried by a fact that says the subscription is no longer paid', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', status: 'ACTIVE', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      // The renewal charge was refused; a billing platform can already have rolled the subscription
      // into the period it is now dunning. Writing that date would hand this company the whole of a
      // cycle it has not paid for — both rules reading this column grant ACCESS from it.
      status: 'past_due',
      recurringInterval: 'month',
      currentPeriodEnd: new Date('2026-11-30T00:00:00.000Z'),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ currentPeriodEnd: expect.anything() }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAST_DUE' }) }),
    );
  });

  it('leaves the stored seats untouched when the webhook carries none', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ seats: expect.anything() }) }),
    );
  });

  describe('never downgrading a company still inside its own valid trial window', () => {
    const trialEndsAt = new Date('2026-09-20T00:00:00Z');
    const now = new Date('2026-09-16T00:00:00Z'); // still 4 days inside the trial

    it.each([
      'incomplete',
      'canceled',
      'past_due',
      'unpaid',
      'paused',
    ])('keeps TRIAL when a stalled/abandoned checkout reports "%s" mid-trial, instead of writing PAST_DUE', async (polarStatus) => {
      getOrCreate.mockResolvedValue({
        companyId: 'company-1',
        status: 'TRIAL',
        trialEndsAt,
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook(
        {
          companyId: 'company-1',
          polarSubscriptionId: 'sub_1',
          polarCustomerId: 'cus_1',
          status: polarStatus,
          recurringInterval: 'month',
        },
        now,
      );

      expect(update).not.toHaveBeenCalled();
    });

    it(
      'records NOTHING at all while the status write is held back — not even the ids/interval/' +
        'lastPolarFactAt this fact also carries — so a later, chronologically OLDER `active` fact for ' +
        'the SAME subscription (delivered out of order) is never wrongly rejected as stale',
      async () => {
        const factAt = new Date('2026-09-16T12:00:00Z');
        getOrCreate.mockResolvedValue({
          companyId: 'company-1',
          status: 'TRIAL',
          trialEndsAt,
          lastPolarFactAt: null,
        });

        await applySubscriptionWebhook(
          {
            companyId: 'company-1',
            polarSubscriptionId: 'sub_1',
            polarCustomerId: 'cus_1',
            status: 'incomplete',
            recurringInterval: 'month',
            factAt,
          },
          now,
        );

        expect(update).not.toHaveBeenCalled();
      },
    );

    it('DOES degrade to PAST_DUE once the trial window has actually ended, even from the same non-active fact', async () => {
      const trialAlreadyEnded = new Date('2026-09-10T00:00:00Z');
      getOrCreate.mockResolvedValue({
        companyId: 'company-1',
        status: 'TRIAL',
        trialEndsAt: trialAlreadyEnded,
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook(
        {
          companyId: 'company-1',
          polarSubscriptionId: 'sub_1',
          polarCustomerId: 'cus_1',
          status: 'canceled',
          recurringInterval: 'month',
        },
        now,
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAST_DUE' }) }),
      );
    });

    it('still degrades an already-ACTIVE (paying) company to PAST_DUE normally — the guard only protects TRIAL', async () => {
      getOrCreate.mockResolvedValue({
        companyId: 'company-1',
        status: 'ACTIVE',
        trialEndsAt,
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook(
        {
          companyId: 'company-1',
          polarSubscriptionId: 'sub_1',
          polarCustomerId: 'cus_1',
          status: 'past_due',
          recurringInterval: 'month',
        },
        now,
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAST_DUE' }) }),
      );
    });

    it('an ACTIVE-mapped fact (a successful payment) is never held back, even mid-trial', async () => {
      getOrCreate.mockResolvedValue({
        companyId: 'company-1',
        status: 'TRIAL',
        trialEndsAt,
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook(
        {
          companyId: 'company-1',
          polarSubscriptionId: 'sub_1',
          polarCustomerId: 'cus_1',
          status: 'active',
          recurringInterval: 'month',
        },
        now,
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
    });
  });

  describe('two webhooks for the SAME subscription, delivered out of order (active vs. canceled)', () => {
    const trialEndsAt = new Date('2026-09-20T00:00:00Z');
    const activeFactAt = new Date('2026-09-16T09:00:00Z'); // the OLDER fact: the real activation
    const canceledFactAt = new Date('2026-09-16T09:05:00Z'); // the NEWER fact: the real cancellation
    const processingTime = new Date('2026-09-16T09:10:00Z'); // both are being handled here, still mid-trial

    const activeFact = {
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      factAt: activeFactAt,
    };
    const canceledFact = {
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'canceled',
      recurringInterval: 'month',
      factAt: canceledFactAt,
    };

    /** A tiny in-memory stand-in for the persisted row, threaded through `getOrCreate`/`update` so two
     *  SEQUENTIAL `applySubscriptionWebhook` calls in one test see each other's writes — exactly like
     *  two real webhook deliveries hitting the same DB row would (the plain per-call mocks used
     *  elsewhere in this file don't carry state between calls, which is exactly wrong for this case). */
    function wireFakeRow(initial: Record<string, unknown>) {
      let row = { ...initial };
      getOrCreate.mockImplementation(async () => row);
      update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data };
        return row;
      });
      return () => row;
    }

    it('in order (active, then canceled): ends PAST_DUE with the real subscription recorded — the baseline this fix must not regress', async () => {
      const currentRow = wireFakeRow({
        companyId: 'company-1',
        status: 'TRIAL',
        trialEndsAt,
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook(activeFact, processingTime);
      await applySubscriptionWebhook(canceledFact, processingTime);

      expect(currentRow()).toMatchObject({ status: 'PAST_DUE', polarSubscriptionId: 'sub_1' });
    });

    it(
      'out of order (canceled processed BEFORE the corresponding active — the real bug scenario): the ' +
        'delayed active still applies, so the company is never left stuck at TRIAL with no memory of ' +
        'its real subscription',
      async () => {
        const currentRow = wireFakeRow({
          companyId: 'company-1',
          status: 'TRIAL',
          trialEndsAt,
          lastPolarFactAt: null,
        });

        await applySubscriptionWebhook(canceledFact, processingTime);
        await applySubscriptionWebhook(activeFact, processingTime);

        // Both orders correctly end up knowing about the real subscription (never permanently lost —
        // the concrete bug this fix closes) and never leave the row stuck at TRIAL. `status` itself
        // still depends on delivery order here (ACTIVE rather than the in-order case's PAST_DUE):
        // making it fully order-independent would require persisting the held-back `canceled` fact for
        // replay once the row leaves TRIAL, which is a bigger change than this guard — out of scope for
        // this fix, which targets the "stuck forever, subscription never recorded" failure specifically.
        expect(currentRow()).toMatchObject({ status: 'ACTIVE', polarSubscriptionId: 'sub_1' });
      },
    );
  });

  it('a PAST_DUE status does not touch blockedAt/zipSentAt/deletionDueAt/seatPaymentFailedAt', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'canceled',
      recurringInterval: 'year',
    });

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'PAST_DUE',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        interval: 'YEAR',
      },
    });
  });

  it('a monthly-to-yearly plan change made from the Polar customer portal (subscription.updated) updates the stored interval to the NEW product, no separate handling needed', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null, interval: 'MONTH' });

    // The subscription object's own `recurringInterval` is what actually changes once a customer
    // switches products through the portal — same subscription id, same customer, only the interval
    // (and, Polar-side, the product) differ. `subscription.updated` carries this the SAME way every
    // other subscription event does, so no event-name branching is needed to catch it.
    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1', // same subscription — a plan CHANGE, not a new one
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'year',
    });

    expect(update.mock.calls[0][0].data).toMatchObject({ interval: 'YEAR' });
  });

  it('an unrecognized recurringInterval leaves the stored interval untouched', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'week',
    });

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('interval');
  });

  it('ignores a webhook whose resolved companyId matches no company AND no stored row matches its subscription id — deleted, never a 500', async () => {
    findCompany.mockResolvedValue(null);
    findLegacyRow.mockResolvedValue(null);

    await expect(
      applySubscriptionWebhook({
        companyId: 'gone-company',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
      }),
    ).resolves.toBeUndefined();

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(recomputeVanished).not.toHaveBeenCalled();
  });

  describe('legacy per-user customer fallback (companyId resolves to no Company row)', () => {
    beforeEach(() => {
      // Under option A a real company's customer external_id is always `company.id` — an old
      // customer's external_id is a USER id, which simply matches no row in `Company` either.
      findCompany.mockResolvedValue(null);
    });

    it('recovers the real company by polarSubscriptionId and recomputes on a canceled/revoked fact', async () => {
      findLegacyRow.mockResolvedValue({
        companyId: 'company-1',
        trialEndsAt: new Date('2026-01-01T00:00:00Z'),
        lastPolarFactAt: null,
      });
      recomputeVanished.mockResolvedValue({ companyId: 'company-1', status: 'PAST_DUE' });
      const factAt = new Date('2026-09-16T10:00:00Z');

      await expect(
        applySubscriptionWebhook({
          companyId: 'user_cGfd91',
          polarSubscriptionId: 'sub_1',
          polarCustomerId: 'cus_legacy',
          status: 'canceled',
          recurringInterval: 'year',
          factAt,
        }),
      ).resolves.toBeUndefined();

      expect(prisma.companySubscription.findFirst).toHaveBeenCalledWith({
        where: { polarSubscriptionId: 'sub_1' },
        select: { companyId: true, trialEndsAt: true, lastPolarFactAt: true },
      });
      expect(recomputeVanished).toHaveBeenCalledWith('company-1', new Date('2026-01-01T00:00:00Z'), factAt);
      expect(update).not.toHaveBeenCalled();
    });

    it("falls back to the row's own lastPolarFactAt as the anchor when this delivery carries no factAt", async () => {
      const lastPolarFactAt = new Date('2026-08-01T00:00:00Z');
      findLegacyRow.mockResolvedValue({
        companyId: 'company-1',
        trialEndsAt: new Date('2026-01-01'),
        lastPolarFactAt,
      });
      recomputeVanished.mockResolvedValue({ companyId: 'company-1', status: 'PAST_DUE' });

      await applySubscriptionWebhook({
        companyId: 'user_cGfd91',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_legacy',
        status: 'revoked',
        recurringInterval: 'year',
      });

      expect(recomputeVanished).toHaveBeenCalledWith('company-1', new Date('2026-01-01'), lastPolarFactAt);
    });

    it('never recomputes on an ACTIVE-mapped fact from a legacy customer — not the scenario this fallback exists for', async () => {
      findLegacyRow.mockResolvedValue({
        companyId: 'company-1',
        trialEndsAt: new Date('2026-01-01'),
        lastPolarFactAt: null,
      });

      await applySubscriptionWebhook({
        companyId: 'user_cGfd91',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_legacy',
        status: 'active',
        recurringInterval: 'year',
      });

      expect(recomputeVanished).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("ignores a legacy fact OLDER than the row's own lastPolarFactAt", async () => {
      findLegacyRow.mockResolvedValue({
        companyId: 'company-1',
        trialEndsAt: new Date('2026-01-01'),
        lastPolarFactAt: new Date('2026-09-16T10:05:00Z'),
      });

      await applySubscriptionWebhook({
        companyId: 'user_cGfd91',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_legacy',
        status: 'canceled',
        recurringInterval: 'year',
        factAt: new Date('2026-09-16T10:00:00Z'),
      });

      expect(recomputeVanished).not.toHaveBeenCalled();
    });
  });

  it('applies a fact unconditionally when no prior fact was ever recorded, and persists factAt', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });
    const factAt = new Date('2026-09-16T10:00:00Z');

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      factAt,
    });

    expect(update.mock.calls[0][0].data).toMatchObject({ lastPolarFactAt: factAt });
  });

  it('ignores a fact OLDER than the last one already applied — a reconcile read racing a fresher webhook', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:05:00Z'),
    });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'past_due',
      recurringInterval: 'month',
      factAt: new Date('2026-09-16T10:00:00Z'), // older than lastPolarFactAt
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('applies a fact NEWER than the last one already applied', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:00:00Z'),
    });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      factAt: new Date('2026-09-16T10:05:00Z'),
    });

    expect(update).toHaveBeenCalled();
  });
});

// Moved here from `polar-plugin.spec.ts` 2026-09-15 alongside `handleSubscriptionPayload` itself —
// see this file's own header. Exercises the REAL `applySubscriptionWebhook` (not a mock of it, unlike
// the old spec) through the SAME prisma double already declared above — end-to-end within this file's
// own boundary, `PolarWebhookController` (the function's real caller now) mocks this whole module.
describe('handleSubscriptionPayload', () => {
  beforeEach(() => {
    findCompany.mockResolvedValue({ id: 'company-1' });
  });
  afterEach(() => vi.resetAllMocks());

  it('threads payload.data.seats through to applySubscriptionWebhook', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        seats: 6,
        metadata: {},
        customerExternalId: 'company-1',
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seats: 6 }) }),
    );
  });

  it('applies the webhook using the customer external id (primary signal, option A)', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: {},
        customerExternalId: 'company-1',
      },
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'ACTIVE',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        interval: 'MONTH',
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        seatPaymentFailedAt: null,
      },
    });
  });

  it('falls back to metadata.companyId when the payload carries no customer external id', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { companyId: 'company-1' },
      },
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-1' } }));
  });

  it('prefers the customer external id over metadata.companyId when both are present', async () => {
    findCompany.mockResolvedValue({ id: 'company-primary' });
    getOrCreate.mockResolvedValue({ companyId: 'company-primary', lastPolarFactAt: null });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { companyId: 'company-fallback' },
        customerExternalId: 'company-primary',
      },
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-primary');
  });

  it('drops a payload with no companyId anywhere, without throwing or touching the DB', async () => {
    await expect(
      handleSubscriptionPayload({
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'active',
          recurringInterval: 'month',
          metadata: {},
        },
      }),
    ).resolves.toBeUndefined();

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('threads factAt through to applySubscriptionWebhook, so a stale reconcile read never overwrites a fresher webhook fact', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:05:00Z'),
    });

    await handleSubscriptionPayload(
      {
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'past_due',
          recurringInterval: 'month',
          metadata: {},
          customerExternalId: 'company-1',
        },
      },
      new Date('2026-09-16T10:00:00Z'),
    );

    expect(update).not.toHaveBeenCalled();
  });
});

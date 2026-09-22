import { vi, type Mock } from 'vitest';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import {
  CompanyCustomerFactsClient,
  getCompanyCustomerFacts,
  hasLegacyPolarCustomer,
  invalidateCompanyCustomerFactsCache,
  resetCompanyCustomerFactsCacheForTests,
  resetLegacyPortalAvailabilityCacheForTests,
} from './legacy-customer';

function fakeClient(
  overrides: { customers?: Partial<CompanyCustomerFactsClient['customers']> } = {},
): CompanyCustomerFactsClient {
  return {
    customers: { getExternal: vi.fn(), getState: vi.fn(), ...overrides.customers },
  } as unknown as CompanyCustomerFactsClient;
}

function notFoundError(): Error {
  return Object.assign(new Error('ResourceNotFound'), { statusCode: 404 });
}

function sub(overrides: Partial<CompanySubscription>): CompanySubscription {
  return {
    id: 'sub-1',
    companyId: 'company-1',
    status: 'ACTIVE',
    trialStartedAt: new Date(),
    trialEndsAt: new Date(),
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    polarCustomerId: null,
    polarSubscriptionId: null,
    seats: 1,
    interval: null,
    seatPaymentFailedAt: null,
    customerSyncFailedAt: null,
    lastCheckoutStartedAt: null,
    lastPolarFactAt: null,
    billingWarningMilestonesSent: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CompanySubscription;
}

describe('getCompanyCustomerFacts', () => {
  beforeEach(() => resetCompanyCustomerFactsCacheForTests());

  it('has a company customer and is not legacy when the company-scoped customer matches the stored id (no getState call needed)', async () => {
    const getState = vi.fn();
    const client = fakeClient({
      customers: { getExternal: vi.fn().mockResolvedValue({ id: 'cus_company' }), getState },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_company' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
    expect(getState).not.toHaveBeenCalled();
  });

  it('has a company customer and flags legacy when the OLD customer (stored id, differing) still has an active subscription', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: vi.fn().mockResolvedValue({ activeSubscriptions: [{ id: 'sub_old' }] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: true });
    expect(client.customers.getState as Mock).toHaveBeenCalledWith({ id: 'cus_old_user_level' });
  });

  it('has a company customer but is NOT legacy when the OLD customer still exists but has no active subscription (canceled)', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: vi.fn().mockResolvedValue({ activeSubscriptions: [] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
  });

  it('has a company customer but is NOT legacy when the OLD customer itself was deleted (404) — the reported incident', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: vi.fn().mockRejectedValue(notFoundError()),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
  });

  it('has no company customer and flags legacy when 404 on the company scope but the OLD customer still has an active subscription', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(notFoundError()),
        getState: vi.fn().mockResolvedValue({ activeSubscriptions: [{ id: 'sub_old' }] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: true });
  });

  it('has no company customer and is not legacy when 404 and no polarCustomerId at all (fresh trial)', async () => {
    const client = fakeClient({ customers: { getExternal: vi.fn().mockRejectedValue(notFoundError()) } });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: null }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: false });
  });

  it('defaults to the safer reading (no notice, no hidden button) on an unrelated Polar failure', async () => {
    const client = fakeClient({
      customers: { getExternal: vi.fn().mockRejectedValue(new Error('polar is down')) },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: false });
    expect(client.customers.getState as Mock).not.toHaveBeenCalled();
  });

  it('caches the result for 5 minutes per company', async () => {
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_company' });
    const client = fakeClient({ customers: { getExternal, getState: vi.fn() } });
    const s = sub({ polarCustomerId: 'cus_company' });

    await getCompanyCustomerFacts(s, client, 0);
    await getCompanyCustomerFacts(s, client, 60_000);
    expect(getExternal).toHaveBeenCalledTimes(1);

    await getCompanyCustomerFacts(s, client, 5 * 60_000 + 1);
    expect(getExternal).toHaveBeenCalledTimes(2);
  });

  // The reported live defect: after a company subscribed successfully, the billing screen kept
  // showing "Subscribe yearly"/"Subscribe monthly" for up to five minutes, and clicking one started a
  // SECOND Polar subscription — traced to `hasCompanyCustomer: false` cached from a dashboard load
  // BEFORE the company ever checked out, still being served well after the checkout completed.
  describe('the reported double-billing defect (a confirmed absence must never be trusted stale)', () => {
    it('never caches a CONFIRMED absence (404) — every call re-verifies directly against Polar, which is what actually keeps this correct across every API replica/worker process, not just this one', async () => {
      const getExternal = vi.fn().mockRejectedValue(notFoundError());
      const client = fakeClient({ customers: { getExternal, getState: vi.fn() } });
      const s = sub({ polarCustomerId: null });

      await getCompanyCustomerFacts(s, client, 0);
      // Still well inside the old 5-minute cache window — a fresh Polar check happens anyway.
      await getCompanyCustomerFacts(s, client, 60_000);

      expect(getExternal).toHaveBeenCalledTimes(2);
    });

    it('DOES still cache a genuine Polar-outage negative (an unrelated failure) — the cache exists so this check does not hammer an already-failing Polar on every status poll', async () => {
      const getExternal = vi.fn().mockRejectedValue(new Error('polar is down'));
      const client = fakeClient({ customers: { getExternal } });
      const s = sub({ polarCustomerId: 'cus_old' });

      await getCompanyCustomerFacts(s, client, 0);
      await getCompanyCustomerFacts(s, client, 60_000);

      expect(getExternal).toHaveBeenCalledTimes(1);
    });

    it(
      'reproduces the defect directly: a company checking out — the write sites (checkout-session.ts, ' +
        'customer-provisioning.ts, webhook-handlers.ts) call invalidateCompanyCustomerFactsCache — sees ' +
        'the fresh answer immediately, well inside the window a stale cache used to keep answering false',
      async () => {
        const getExternal = vi
          .fn()
          .mockRejectedValueOnce(notFoundError()) // the dashboard load BEFORE the company subscribed
          .mockResolvedValueOnce({ id: 'cus_company' }); // Polar now has the company-scoped customer
        const client = fakeClient({ customers: { getExternal, getState: vi.fn() } });
        const s = sub({ polarCustomerId: null });

        expect(await getCompanyCustomerFacts(s, client, 0)).toEqual({
          hasCompanyCustomer: false,
          legacySubscription: false,
        });

        invalidateCompanyCustomerFactsCache('company-1');

        expect(await getCompanyCustomerFacts(s, client, 60_000)).toEqual({
          hasCompanyCustomer: true,
          legacySubscription: false,
        });
        expect(getExternal).toHaveBeenCalledTimes(2);
      },
    );

    it('invalidateCompanyCustomerFactsCache also clears a cached CONFIRMED true — belt-and-braces for the single-process case', async () => {
      const getExternal = vi.fn().mockResolvedValue({ id: 'cus_company' });
      const client = fakeClient({ customers: { getExternal, getState: vi.fn() } });
      const s = sub({ polarCustomerId: 'cus_company' });

      await getCompanyCustomerFacts(s, client, 0);
      invalidateCompanyCustomerFactsCache('company-1');
      await getCompanyCustomerFacts(s, client, 60_000);

      expect(getExternal).toHaveBeenCalledTimes(2);
    });

    it('invalidateCompanyCustomerFactsCache only clears the named company, never every company (unlike resetCompanyCustomerFactsCacheForTests)', async () => {
      const getExternalA = vi.fn().mockResolvedValue({ id: 'cus_a' });
      const getExternalB = vi.fn().mockResolvedValue({ id: 'cus_b' });
      const clientA = fakeClient({ customers: { getExternal: getExternalA, getState: vi.fn() } });
      const clientB = fakeClient({ customers: { getExternal: getExternalB, getState: vi.fn() } });
      const subA = sub({ companyId: 'company-a', polarCustomerId: 'cus_a' });
      const subB = sub({ companyId: 'company-b', polarCustomerId: 'cus_b' });

      await getCompanyCustomerFacts(subA, clientA, 0);
      await getCompanyCustomerFacts(subB, clientB, 0);

      invalidateCompanyCustomerFactsCache('company-a');

      await getCompanyCustomerFacts(subA, clientA, 60_000);
      await getCompanyCustomerFacts(subB, clientB, 60_000);

      expect(getExternalA).toHaveBeenCalledTimes(2); // invalidated — re-checked
      expect(getExternalB).toHaveBeenCalledTimes(1); // untouched — still cached
    });
  });
});

describe('hasLegacyPolarCustomer', () => {
  beforeEach(() => resetLegacyPortalAvailabilityCacheForTests());

  it('is true when a Polar customer exists at this user id', async () => {
    const client = fakeClient({
      customers: { getExternal: vi.fn().mockResolvedValue({ id: 'cus_user' }) },
    });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(true);
  });

  it('is false on a 404', async () => {
    const client = fakeClient({ customers: { getExternal: vi.fn().mockRejectedValue(notFoundError()) } });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(false);
  });

  it('is false (never throws) on an unrelated Polar failure', async () => {
    const client = fakeClient({
      customers: { getExternal: vi.fn().mockRejectedValue(new Error('polar is down')) },
    });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(false);
  });

  it('caches the result for 5 minutes per user', async () => {
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_user' });
    const client = fakeClient({ customers: { getExternal } });

    await hasLegacyPolarCustomer('user-1', client, 0);
    await hasLegacyPolarCustomer('user-1', client, 60_000);
    expect(getExternal).toHaveBeenCalledTimes(1);

    await hasLegacyPolarCustomer('user-1', client, 5 * 60_000 + 1);
    expect(getExternal).toHaveBeenCalledTimes(2);
  });
});

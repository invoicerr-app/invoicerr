import { BillingController } from './billing.controller';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { createCustomerPortalSession } from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

jest.mock('./company-subscription.store');
jest.mock('./status-reconcile');
jest.mock('./portal-session');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const reconcile = reconcileFromPolarIfStale as jest.Mock;
const createPortalSession = createCustomerPortalSession as jest.Mock;

describe('BillingController.getStatus', () => {
  afterEach(() => jest.resetAllMocks());

  it('lazily gets-or-creates the subscription for the active company, reconciles it against Polar, and returns its computed view', async () => {
    const stored = {
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
    };
    getOrCreate.mockResolvedValue(stored);
    reconcile.mockResolvedValue(stored);
    const controller = new BillingController();

    const view = await controller.getStatus('company-1');

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(reconcile).toHaveBeenCalledWith(stored);
    expect(view.status).toBe('TRIAL');
    expect(view.checkoutUrl).toBe('/api/auth/checkout');
    expect(view.portalUrl).toBe('/api/billing/portal');
  });

  it("returns the reconciled row's status when Polar repaired it", async () => {
    getOrCreate.mockResolvedValue({
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
    });
    reconcile.mockResolvedValue({
      status: 'ACTIVE',
      seats: 1,
      interval: 'YEAR',
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
    });
    const controller = new BillingController();

    const view = await controller.getStatus('company-1');

    expect(view.status).toBe('ACTIVE');
  });
});

describe('BillingController.openPortal', () => {
  afterEach(() => jest.resetAllMocks());

  it("opens a portal session for the caller's own user id", async () => {
    createPortalSession.mockResolvedValue({ url: 'https://polar.sh/portal/abc', redirect: true });
    const controller = new BillingController();

    const result = await controller.openPortal({ id: 'user-1', email: 'user@example.com' } as never);

    expect(createPortalSession).toHaveBeenCalledWith('user-1', expect.any(String));
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });
});

import { BillingController } from './billing.controller';
import { getOrCreateCompanySubscription } from './company-subscription.store';

jest.mock('./company-subscription.store');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;

describe('BillingController.getStatus', () => {
  afterEach(() => jest.resetAllMocks());

  it('lazily gets-or-creates the subscription for the active company and returns its computed view', async () => {
    getOrCreate.mockResolvedValue({
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
    });
    const controller = new BillingController();

    const view = await controller.getStatus('company-1');

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(view.status).toBe('TRIAL');
    expect(view.checkoutUrl).toBe('/api/auth/checkout');
    expect(view.portalUrl).toBe('/api/auth/customer/portal');
  });
});

import { vi, type Mock } from 'vitest';

import { BillingController } from './billing.controller';
import { getOrCreateCompanySubscription } from './company-subscription.store';

vi.mock('./company-subscription.store');

const getOrCreate = getOrCreateCompanySubscription as Mock;

describe('BillingController.getStatus', () => {
  afterEach(() => vi.resetAllMocks());

  it('lazily gets-or-creates the subscription for the active company and returns the computed view', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
      currentPeriodEnd: null,
    });

    const view = await new BillingController().getStatus('company-1');

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(view).toMatchObject({
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: '2026-09-22T00:00:00.000Z',
    });
  });
});

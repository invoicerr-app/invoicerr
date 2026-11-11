import { describe, expect, it, vi } from 'vitest';

import { DeclarationProviderRegistry } from './declaration-provider';

const result = {
  statusCode: 'SUBMITTED',
  authorityId: '1',
  observedAt: new Date('2026-11-10T00:00:00.000Z'),
  rawPayload: {},
};

describe('DeclarationProviderRegistry', () => {
  it('keeps the optional methods of a provider it wraps for the demo guard', async () => {
    const declarePayment = vi.fn().mockResolvedValue(result);
    const syncCompanyProfile = vi.fn().mockResolvedValue(undefined);
    const registry = new DeclarationProviderRegistry();
    registry.register({
      providerId: 'fixture',
      declare: vi.fn().mockResolvedValue(result),
      declarePayment,
      syncCompanyProfile,
    });

    const provider = registry.resolve('fixture');
    expect(provider).toBeDefined();

    await provider?.declarePayment?.('company-1', {} as never);
    await provider?.syncCompanyProfile?.('company-1');

    expect(declarePayment).toHaveBeenCalledTimes(1);
    expect(syncCompanyProfile).toHaveBeenCalledWith('company-1');
  });

  it('leaves an invoice-only provider invoice-only', () => {
    const registry = new DeclarationProviderRegistry();
    registry.register({ providerId: 'fixture', declare: vi.fn() });

    expect(registry.resolve('fixture')?.declarePayment).toBeUndefined();
    expect(registry.resolve('fixture')?.syncCompanyProfile).toBeUndefined();
  });
});

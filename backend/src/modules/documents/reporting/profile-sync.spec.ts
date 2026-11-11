import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as countryPolicy from '../country-policy/country-policy';
import { DeclarationProviderRegistry } from './declaration-provider';
import { syncDeclaredCompanyProfile } from './profile-sync';
import { ReportingObligationCatalog } from './registry';

vi.mock('../country-policy/country-policy');

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as Mock;

const catalog = new ReportingObligationCatalog([
  {
    countryCode: 'ZZ',
    facts: [
      {
        providerId: 'zz-transport',
        appliesTo: 'invoice',
        dischargedBy: 'transport',
        provenance: { kind: 'unverified', resolutionNote: 'fixture: transport' },
      },
      {
        providerId: 'zz-provider',
        appliesTo: 'invoice',
        dischargedBy: 'provider',
        provenance: { kind: 'unverified', resolutionNote: 'fixture: provider' },
      },
    ],
  },
]);

function registryWith(syncCompanyProfile: Mock) {
  const provider = { providerId: 'zz-provider', declare: vi.fn(), syncCompanyProfile };
  return {
    resolve: (providerId: string) => (providerId === 'zz-provider' ? provider : undefined),
  } as unknown as DeclarationProviderRegistry;
}

describe('syncDeclaredCompanyProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes the profile through the provider that discharges the obligation, never the transport', async () => {
    mockedResolveCountry.mockResolvedValue('ZZ');
    const syncCompanyProfile = vi.fn().mockResolvedValue(undefined);
    const buildRegistry = vi.fn(() => registryWith(syncCompanyProfile));

    await syncDeclaredCompanyProfile('company-1', { catalog, buildRegistry });

    expect(syncCompanyProfile).toHaveBeenCalledWith('company-1');
    expect(buildRegistry).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the platform cannot be reached', async () => {
    mockedResolveCountry.mockResolvedValue('ZZ');
    const syncCompanyProfile = vi.fn().mockRejectedValue(new Error('platform down'));

    await expect(
      syncDeclaredCompanyProfile('company-1', {
        catalog,
        buildRegistry: () => registryWith(syncCompanyProfile),
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing for a company with no reporting obligation', async () => {
    mockedResolveCountry.mockResolvedValue('YY');
    const buildRegistry = vi.fn();

    await syncDeclaredCompanyProfile('company-1', { catalog, buildRegistry });

    expect(buildRegistry).not.toHaveBeenCalled();
  });

  it('does nothing when the seller country cannot be resolved', async () => {
    mockedResolveCountry.mockResolvedValue(undefined);
    const buildRegistry = vi.fn();

    await syncDeclaredCompanyProfile('company-1', { catalog, buildRegistry });

    expect(buildRegistry).not.toHaveBeenCalled();
  });
});

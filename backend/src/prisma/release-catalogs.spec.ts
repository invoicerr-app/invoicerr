/**
 * `releaseCatalogs()` — the deliberate, single-run purge every automatic boot path refuses to do
 * (see this module's own header). Every catalog/seed module is mocked: this proves the
 * ORCHESTRATION (every seed/upsert called WITH the purge on, against a fixed small "catalog", and
 * "which country got removed" correctly named from a snapshot taken before the purge runs) — the
 * underlying purge mechanics themselves are already proven by
 * country-policy/seed.spec.ts, country-identifiers/seed.spec.ts and b2g-routing/boot-upsert.spec.ts.
 */

import { vi, type Mock } from 'vitest';

vi.mock('../modules/documents/country-policy/seed');
vi.mock('../modules/documents/country-policy/registry', () => ({
  defaultCountryPolicyCatalog: { countries: vi.fn(() => ['FR', 'DE']) },
}));
vi.mock('../modules/documents/country-identifiers/seed');
vi.mock('../modules/documents/country-identifiers/registry', () => ({
  defaultCountryIdentifierRequirementsCatalog: { countries: vi.fn(() => ['FR', 'DE']) },
}));
vi.mock('../modules/documents/b2g-routing/boot-upsert');
vi.mock('../modules/documents/b2g-routing/registry', () => ({
  defaultB2gRoutingCatalog: { countries: vi.fn(() => ['FR']) },
}));

import { seedCountryPolicies } from '../modules/documents/country-policy/seed';
import { defaultCountryPolicyCatalog } from '../modules/documents/country-policy/registry';
import { seedCountryIdentifierRequirements } from '../modules/documents/country-identifiers/seed';
import { defaultCountryIdentifierRequirementsCatalog } from '../modules/documents/country-identifiers/registry';
import { upsertB2gRoutingRules } from '../modules/documents/b2g-routing/boot-upsert';
import { defaultB2gRoutingCatalog } from '../modules/documents/b2g-routing/registry';
import { PrismaCatalogReleaseClient, releaseCatalogs } from './release-catalogs';

const mockedSeedCountryPolicies = seedCountryPolicies as Mock;
const mockedSeedCountryIdentifierRequirements = seedCountryIdentifierRequirements as Mock;
const mockedUpsertB2gRoutingRules = upsertB2gRoutingRules as Mock;

function buildFakeClient(rows: {
  policy: string[];
  identifiers: string[];
  b2g: string[];
}): PrismaCatalogReleaseClient {
  return {
    documentCountryActionRule: {
      findMany: async () => rows.policy.map((countryCode) => ({ countryCode }) as never),
      upsert: async () => undefined,
      deleteMany: async () => undefined,
    },
    countryIdentifierRequirement: {
      findMany: async () => rows.identifiers.map((countryCode) => ({ countryCode }) as never),
      upsert: async () => undefined,
      deleteMany: async () => undefined,
    },
    b2gRoutingRule: {
      findMany: async () => rows.b2g.map((countryCode) => ({ id: countryCode, countryCode })),
      upsert: async () => undefined,
      deleteMany: async () => undefined,
    },
    $transaction: async (fn) => fn(buildFakeClient(rows)),
  } as unknown as PrismaCatalogReleaseClient;
}

describe('releaseCatalogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSeedCountryPolicies.mockResolvedValue({ upserted: 2, deleted: 1 });
    mockedSeedCountryIdentifierRequirements.mockResolvedValue({ upserted: 2, deleted: 0 });
    mockedUpsertB2gRoutingRules.mockResolvedValue({ upserted: 1, deleted: 1 });
  });

  it('calls every seed/upsert WITH the whole-country purge on, against the real default catalog', async () => {
    const client = buildFakeClient({ policy: ['FR', 'DE'], identifiers: ['FR', 'DE'], b2g: ['FR'] });

    await releaseCatalogs(client);

    expect(mockedSeedCountryPolicies).toHaveBeenCalledWith(client, defaultCountryPolicyCatalog, true);
    expect(mockedSeedCountryIdentifierRequirements).toHaveBeenCalledWith(
      client,
      defaultCountryIdentifierRequirementsCatalog,
      true,
    );
    expect(mockedUpsertB2gRoutingRules).toHaveBeenCalledWith(client, defaultB2gRoutingCatalog, true);
  });

  it('THE MUTATION TARGET: names which countries are being removed, per catalog, from a BEFORE snapshot', async () => {
    const client = buildFakeClient({
      policy: ['FR', 'DE', 'ES'], // ES no longer in the (mocked) catalog ['FR', 'DE']
      identifiers: ['FR', 'DE'], // nothing removed here
      b2g: ['FR', 'PL'], // PL no longer in the (mocked) catalog ['FR']
    });

    const summary = await releaseCatalogs(client);

    expect(summary.countryPolicy.removedCountries).toEqual(['ES']);
    expect(summary.countryIdentifiers.removedCountries).toEqual([]);
    expect(summary.b2gRouting.removedCountries).toEqual(['PL']);
    // The counts themselves pass straight through from each underlying summary, untouched.
    expect(summary.countryPolicy.upserted).toBe(2);
    expect(summary.countryPolicy.deleted).toBe(1);
  });

  it('an unchanged catalog reports no removed countries at all', async () => {
    const client = buildFakeClient({ policy: ['FR', 'DE'], identifiers: ['FR', 'DE'], b2g: ['FR'] });

    const summary = await releaseCatalogs(client);

    expect(summary.countryPolicy.removedCountries).toEqual([]);
    expect(summary.countryIdentifiers.removedCountries).toEqual([]);
    expect(summary.b2gRouting.removedCountries).toEqual([]);
  });
});

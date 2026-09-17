/**
 * `syncDatabaseSchema()` must NEVER purge a whole country from either catalog it reseeds at boot —
 * see `country-policy/seed.ts`'s own `purgeRemovedCountries` doc comment for the full "rolling
 * deployment"/"stale self-hosted restart" account this closes. Everything DB- and subprocess-facing
 * (`prisma.$queryRawUnsafe`, `execFileSync`, the two seed functions) is mocked: this spec proves
 * WHAT `syncDatabaseSchema` asks the seeds to do, not that a real `migrate deploy` succeeds (that is
 * `migration-fresh-schema.spec.ts`'s job, gated on a real throwaway Postgres).
 */
jest.mock('child_process');
jest.mock('./prisma.service', () => ({
  __esModule: true,
  default: { $queryRawUnsafe: jest.fn() },
}));
jest.mock('../modules/documents/country-policy/seed');
jest.mock('../modules/documents/country-identifiers/seed');

import { execFileSync } from 'child_process';

import prisma from './prisma.service';
import { seedCountryPolicies } from '../modules/documents/country-policy/seed';
import { seedCountryIdentifierRequirements } from '../modules/documents/country-identifiers/seed';
import { syncDatabaseSchema } from './sync-schema';

const mockedExecFileSync = execFileSync as unknown as jest.Mock;
const mockedQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as jest.Mock;
const mockedSeedCountryPolicies = seedCountryPolicies as jest.Mock;
const mockedSeedCountryIdentifierRequirements = seedCountryIdentifierRequirements as jest.Mock;

describe('syncDatabaseSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `_prisma_migrations` already exists — `baselineIfNeeded()` short-circuits immediately, so the
    // only `$queryRawUnsafe` call this test needs to account for is that one existence check.
    mockedQueryRawUnsafe.mockResolvedValue([{ exists: '_prisma_migrations' }]);
    mockedExecFileSync.mockReturnValue(Buffer.from(''));
    mockedSeedCountryPolicies.mockResolvedValue({ upserted: 0, deleted: 0 });
    mockedSeedCountryIdentifierRequirements.mockResolvedValue({ upserted: 0, deleted: 0 });
  });

  it('THE MUTATION TARGET: never purges a whole country — both seeds are called with purgeRemovedCountries: false', async () => {
    await syncDatabaseSchema();

    expect(mockedSeedCountryPolicies).toHaveBeenCalledWith(prisma, undefined, false);
    expect(mockedSeedCountryIdentifierRequirements).toHaveBeenCalledWith(prisma, undefined, false);
  });

  it('still runs `migrate deploy` and both seeds, in order', async () => {
    await syncDatabaseSchema();

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['prisma', 'migrate', 'deploy']),
      expect.anything(),
    );
    expect(mockedSeedCountryPolicies).toHaveBeenCalledTimes(1);
    expect(mockedSeedCountryIdentifierRequirements).toHaveBeenCalledTimes(1);
  });
});

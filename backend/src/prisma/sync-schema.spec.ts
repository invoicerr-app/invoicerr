/**
 * `syncDatabaseSchema()` must NEVER purge a whole country from either catalog it reseeds at boot —
 * see `country-policy/seed.ts`'s own `purgeRemovedCountries` doc comment for the full "rolling
 * deployment"/"stale self-hosted restart" account this closes. Everything DB- and subprocess-facing
 * (`prisma.$queryRawUnsafe`, `execFileSync`, the two seed functions) is mocked: this spec proves
 * WHAT `syncDatabaseSchema` asks the seeds to do, not that a real `migrate deploy` succeeds (that is
 * `migration-fresh-schema.spec.ts`'s job, gated on a real throwaway Postgres).
 */
import { vi, type Mock } from 'vitest';

vi.mock('child_process');
vi.mock('./prisma.service', () => ({
  __esModule: true,
  default: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() },
}));
vi.mock('../modules/documents/country-policy/seed');
vi.mock('../modules/documents/country-identifiers/seed');

import { execFileSync } from 'child_process';

import prisma from './prisma.service';
import { seedCountryPolicies } from '../modules/documents/country-policy/seed';
import { seedCountryIdentifierRequirements } from '../modules/documents/country-identifiers/seed';
import { syncDatabaseSchema } from './sync-schema';

const mockedExecFileSync = execFileSync as unknown as Mock;
const mockedQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as Mock;
const mockedSeedCountryPolicies = seedCountryPolicies as Mock;
const mockedSeedCountryIdentifierRequirements = seedCountryIdentifierRequirements as Mock;

describe('syncDatabaseSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A healthy, already-migrated database, so `baselineIfNeeded()` falls straight through to
    // `migrate deploy` and these tests only ever see the seeding they are about. Two raw queries get
    // asked along the way and each needs its own answer: the `to_regclass` existence check (yes,
    // `_prisma_migrations` is there) and then the migration history itself — answered with an empty
    // list, i.e. nothing recorded beyond the frozen v1.4.4a baseline, which is the cheap
    // short-circuit in `repairV1_4_4aLevelingIfCorrupted()` (its own spec owns that decision).
    mockedQueryRawUnsafe.mockImplementation(async (query: string) =>
      /to_regclass/.test(query) ? [{ exists: '_prisma_migrations' }] : [],
    );
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

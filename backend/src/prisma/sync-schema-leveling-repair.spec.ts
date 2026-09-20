/**
 * `repairV1_4_4aLevelingIfCorrupted()` decides whether a database's migration history is lying about
 * its own schema, and that decision is the only thing this spec exercises. Everything it would
 * otherwise reach — the `prisma migrate diff` subprocess, the `_prisma_migrations` table itself — is
 * mocked, so each test is one pair of answers ("what does the history claim", "what does the schema
 * actually look like") and the verdict they produce.
 *
 * The verdict matters far more than the repair it triggers: firing on a HEALTHY database would delete
 * true migration records and re-run ~100 migrations against a schema that already has their effects,
 * which destroys data. So the cases below are weighted towards proving the detection stays OFF —
 * including on the one healthy shape that superficially resembles the broken one (a database that
 * genuinely is at v1.4.4a, whose schema therefore diffs clean against the frozen datamodel).
 *
 * That the repair actually unblocks a real `migrate deploy` is not provable with mocks and is not
 * claimed here; it was established against a throwaway Postgres carrying the real v1.4.4a-shaped
 * fixture.
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
import { repairV1_4_4aLevelingIfCorrupted } from './sync-schema';

const mockedExecFileSync = execFileSync as unknown as Mock;
const mockedQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as Mock;
const mockedExecuteRawUnsafe = prisma.$executeRawUnsafe as unknown as Mock;

// Three of the 23 migrations the frozen v1.4.4a baseline covers, and three that came after it. The
// tests only ever need "is this name inside or outside the baseline", so a representative handful is
// enough — and keeps them from re-encoding the frozen list, which must stay owned by sync-schema.ts.
const BASELINE_SAMPLE = [
  '20250906170944_initial_migration',
  '20251213184817_add_log_table',
  '20260219120000_add_discount_rate_percent',
];
const POST_V1_4_4A_SAMPLE = [
  '20260621230759_add_api_keys',
  '20260624130000_rename_receipt_to_payment',
  '20260625010000_add_minor_unit_columns',
];

function historyClaims(names: string[]): void {
  mockedQueryRawUnsafe.mockResolvedValue(names.map((migration_name) => ({ migration_name })));
}

/** `prisma migrate diff --exit-code`: 0 = the two sides are identical, 2 = they differ, 1 = error. */
function diffExitsWith(status: number): void {
  mockedExecFileSync.mockImplementation(() => {
    if (status === 0) return Buffer.from('');
    throw Object.assign(new Error(`Command failed (status ${status})`), { status });
  });
}

describe('repairV1_4_4aLevelingIfCorrupted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('leaves a healthy database alone', () => {
    it('does nothing — and never even asks the schema — when the history claims only baselined v1.4.4a migrations', async () => {
      // A database caught between `baselineIfNeeded()`'s 23 `migrate resolve --applied` calls and its
      // `migrate deploy`: genuinely at v1.4.4a, so a diff against the frozen datamodel WOULD come back
      // clean. It is only the absence of any claim beyond the baseline that separates it from a
      // corrupted database, which is exactly why that is the first question asked.
      historyClaims(BASELINE_SAMPLE);
      diffExitsWith(0);

      expect(await repairV1_4_4aLevelingIfCorrupted()).toEqual([]);
      expect(mockedExecFileSync).not.toHaveBeenCalled();
      expect(mockedExecuteRawUnsafe).not.toHaveBeenCalled();
    });

    it('does nothing on an already-migrated database, whose schema is past v1.4.4a', async () => {
      historyClaims([...BASELINE_SAMPLE, ...POST_V1_4_4A_SAMPLE]);
      diffExitsWith(2);

      expect(await repairV1_4_4aLevelingIfCorrupted()).toEqual([]);
      expect(mockedExecuteRawUnsafe).not.toHaveBeenCalled();
    });

    it('does nothing when the schema comparison itself fails — an undetermined answer is never treated as corruption', async () => {
      historyClaims([...BASELINE_SAMPLE, ...POST_V1_4_4A_SAMPLE]);
      diffExitsWith(1);

      expect(await repairV1_4_4aLevelingIfCorrupted()).toEqual([]);
      expect(mockedExecuteRawUnsafe).not.toHaveBeenCalled();
    });

    it('does nothing when the diff subprocess dies without an exit status at all (no npx, killed, ENOENT)', async () => {
      historyClaims([...BASELINE_SAMPLE, ...POST_V1_4_4A_SAMPLE]);
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('spawn npx ENOENT');
      });

      expect(await repairV1_4_4aLevelingIfCorrupted()).toEqual([]);
      expect(mockedExecuteRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('repairs the levelled-down database', () => {
    beforeEach(() => {
      historyClaims([...BASELINE_SAMPLE, ...POST_V1_4_4A_SAMPLE]);
      diffExitsWith(0);
      mockedExecuteRawUnsafe.mockResolvedValue(POST_V1_4_4A_SAMPLE.length);
    });

    it('THE MUTATION TARGET: retracts exactly the claims the schema contradicts, and no baselined one', async () => {
      expect(await repairV1_4_4aLevelingIfCorrupted()).toEqual(POST_V1_4_4A_SAMPLE);

      const [statement, ...parameters] = mockedExecuteRawUnsafe.mock.calls[0];
      expect(statement).toMatch(/DELETE FROM "_prisma_migrations"/);
      // The baseline is what SURVIVES: the statement names the migrations to keep, so a name that
      // ever dropped out of that frozen list would be deleted and re-run rather than silently kept.
      expect(statement).toMatch(/NOT IN \(\$1(, \$\d+)*\)/);
      expect(parameters).toContain('20250906170944_initial_migration');
      expect(parameters).toContain('20260219120000_add_discount_rate_percent');
      expect(parameters).not.toContain('20260624130000_rename_receipt_to_payment');
      expect(parameters).toHaveLength(statement.match(/\$\d+/g)?.length ?? 0);
    });

    it('compares against the FROZEN v1.4.4a datamodel, read-only, with --exit-code to get an answer', async () => {
      await repairV1_4_4aLevelingIfCorrupted();

      const [command, args] = mockedExecFileSync.mock.calls[0];
      expect(command).toBe('npx');
      expect(args).toEqual(
        expect.arrayContaining(['migrate', 'diff', '--from-config-datasource', '--exit-code']),
      );
      expect(args.join(' ')).toMatch(/--to-schema \S*schema-v1\.4\.4a\.prisma/);
    });
  });

  it('counts only migrations the history claims SUCCEEDED — a failed row claims nothing and must keep tripping P3009', async () => {
    await repairV1_4_4aLevelingIfCorrupted().catch(() => undefined);

    // Prisma marks a failed migration with `finished_at IS NULL` and keeps the row so `migrate deploy`
    // refuses to continue until a human looks. Reading those as "the history claims this ran" would
    // turn that deliberate stop into an automatic retry on a database nobody has inspected.
    const [query] = mockedQueryRawUnsafe.mock.calls[0];
    expect(query).toMatch(/finished_at IS NOT NULL/);
    expect(query).toMatch(/rolled_back_at IS NULL/);
  });
});

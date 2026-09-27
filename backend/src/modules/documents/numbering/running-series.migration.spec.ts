/**
 * Issue #496 - the proof that switching to per-country number formats changes NO issued number and
 * opens NO gap and NO duplicate, on real data shapes, against a real Postgres.
 *
 * It runs the migration file itself (`20260928000000_issue_496_freeze_running_number_series`), read
 * from disk, never a copy of its SQL, then numbers the next documents through the real numbering path
 * (`take-number.ts`, the same call `documents.service.ts#runAction` makes).
 *
 * The companies are built in the shapes the database really holds before the migration:
 *  - FR: a custom invoice series ("FAC-{year}-{number:5}") with three issued invoices; a legacy quote
 *    entry left by `20260913120000_migrate_legacy_number_formats` with no quote ever numbered; and two
 *    credit notes issued under the old shared default ("CREDIT-NOTE-2026-0001", 21 characters), which
 *    breaks Chorus Pro's 20.
 *  - IT: no entry at all, invoices and a credit note issued under the old defaults.
 *  - PT: the per-year ATCUD series ("FT {year}/{number:4}") the old settings screen made every
 *    Portuguese company configure, two invoices issued.
 *  - DE: a custom format chosen but never used.
 *  - PL: an empty-string entry and a non-string entry (a hand-edited or corrupted JSON), invoices issued.
 *
 * The migration is a global UPDATE, and this database is shared with every other spec file running in
 * parallel. So it runs inside a transaction that is ROLLED BACK after reading what it computed for this
 * file's own companies, and those values are then written to those companies alone - the other files'
 * companies never see it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

import { takeDocumentNumberForTransition } from './take-number';

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../../../prisma/migrations/20260928000000_issue_496_freeze_running_number_series/migration.sql',
  ),
  'utf-8',
);

const YEAR = new Date().getFullYear();
const stamp = `${Date.now()}-${Math.random()}`;

interface Seed {
  key: string;
  country: string;
  countryCode: string;
  numberFormats: Prisma.InputJsonValue | undefined;
  /** typeId -> the display numbers already issued, in order (numbers 1..n). */
  issued: Record<string, string[]>;
}

const SEEDS: Seed[] = [
  {
    key: 'fr',
    country: 'France',
    countryCode: 'FR',
    numberFormats: { invoice: 'FAC-{year}-{number:5}', quote: 'Q-{year}-{number:4}' },
    issued: {
      invoice: ['FAC-2026-00001', 'FAC-2026-00002', 'FAC-2026-00003'],
      'credit-note': ['CREDIT-NOTE-2026-0001', 'CREDIT-NOTE-2026-0002'],
    },
  },
  {
    key: 'it',
    country: 'Italy',
    countryCode: 'IT',
    numberFormats: undefined,
    issued: {
      invoice: ['INVOICE-2026-0001', 'INVOICE-2026-0002'],
      'credit-note': ['CREDIT-NOTE-2026-0001'],
    },
  },
  {
    key: 'pt',
    country: 'Portugal',
    countryCode: 'PT',
    numberFormats: { invoice: 'FT {year}/{number:4}' },
    issued: { invoice: ['FT 2026/0001', 'FT 2026/0002'] },
  },
  {
    key: 'de',
    country: 'Germany',
    countryCode: 'DE',
    numberFormats: { invoice: 'RE-{number}' },
    issued: {},
  },
  {
    key: 'pl',
    country: 'Poland',
    countryCode: 'PL',
    numberFormats: { invoice: '', quote: 42 },
    issued: { invoice: ['INVOICE-2026-0001'], quote: ['QUOTE-2026-0001', 'QUOTE-2026-0002'] },
  },
];

const companyIds: Record<string, string> = {};

async function seedCompany(seed: Seed): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Running series ${seed.key} ${stamp}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Test',
      country: seed.country,
      countryCode: seed.countryCode,
      phone: '+10000000000',
      email: `running-series-${seed.key}-${stamp}@example.com`,
      numberFormats: seed.numberFormats,
    },
    select: { id: true },
  });
  for (const [typeId, displayNumbers] of Object.entries(seed.issued)) {
    for (const [index, displayNumber] of displayNumbers.entries()) {
      await prisma.documentInstance.create({
        data: {
          companyId: company.id,
          typeId,
          status: 'sent',
          data: { issueDate: '2026-03-01' },
          number: index + 1,
          displayNumber,
        },
      });
    }
    // The shape `bumpSequence` leaves behind: "the number handed out NEXT".
    await prisma.documentNumberSequence.create({
      data: { companyId: company.id, typeId, nextNumber: displayNumbers.length + 1 },
    });
  }
  return company.id;
}

async function issuedSnapshot(): Promise<
  { id: string; number: number | null; displayNumber: string | null }[]
> {
  return prisma.documentInstance.findMany({
    where: { companyId: { in: Object.values(companyIds) } },
    select: { id: true, number: true, displayNumber: true },
    orderBy: { id: 'asc' },
  });
}

async function numberNext(key: string, typeId: string) {
  const doc = await prisma.documentInstance.create({
    data: { companyId: companyIds[key], typeId, status: 'draft', data: { issueDate: '2026-09-28' } },
    select: { id: true },
  });
  return takeDocumentNumberForTransition(companyIds[key], typeId, doc.id);
}

class Rollback extends Error {}

describe('migration 20260928000000_issue_496_freeze_running_number_series, on real data shapes', () => {
  let before: Awaited<ReturnType<typeof issuedSnapshot>>;
  let frozen: Record<string, unknown>;
  let secondRunUnchanged = false;

  beforeAll(async () => {
    for (const seed of SEEDS) companyIds[seed.key] = await seedCompany(seed);
    before = await issuedSnapshot();

    const computed: Record<string, unknown> = {};
    await prisma
      .$transaction(
        async (tx) => {
          const read = () =>
            tx.company.findMany({
              where: { id: { in: Object.values(companyIds) } },
              select: { id: true, numberFormats: true },
              orderBy: { id: 'asc' },
            });
          await tx.$executeRawUnsafe(MIGRATION_SQL);
          const afterFirstRun = await read();
          await tx.$executeRawUnsafe(MIGRATION_SQL);
          secondRunUnchanged = JSON.stringify(await read()) === JSON.stringify(afterFirstRun);
          for (const row of afterFirstRun) computed[row.id] = row.numberFormats;
          throw new Rollback();
        },
        { timeout: 30_000 },
      )
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    frozen = computed;

    for (const [id, value] of Object.entries(computed)) {
      await prisma.company.update({
        where: { id },
        data: { numberFormats: value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue) },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: Object.values(companyIds) } } });
  });

  it('is idempotent: a second run over its own result changes nothing', () => {
    expect(secondRunUnchanged).toBe(true);
  });

  it('freezes exactly one entry per type already numbered, holding the format that series ran under', () => {
    expect(frozen[companyIds.fr]).toEqual({
      invoice: 'FAC-{year}-{number:5}',
      // Never set explicitly: the old shared default is what numbered them.
      'credit-note': 'CREDIT-NOTE-{year}-{number:4}',
      // `quote` dropped: never numbered, so no series to continue.
    });
    expect(frozen[companyIds.it]).toEqual({
      invoice: 'INVOICE-{year}-{number:4}',
      'credit-note': 'CREDIT-NOTE-{year}-{number:4}',
    });
    expect(frozen[companyIds.pt]).toEqual({ invoice: 'FT {year}/{number:4}' });
    // A format chosen but never used has no series behind it.
    expect(frozen[companyIds.de]).toBeNull();
    // An empty or non-string entry was never a usable format: the old default numbered those series.
    expect(frozen[companyIds.pl]).toEqual({
      invoice: 'INVOICE-{year}-{number:4}',
      quote: 'QUOTE-{year}-{number:4}',
    });
  });

  it('changes no issued number, and leaves every counter where it stood', async () => {
    expect(await issuedSnapshot()).toEqual(before);
    const sequences = await prisma.documentNumberSequence.findMany({
      where: { companyId: { in: Object.values(companyIds) } },
      select: { companyId: true, typeId: true, nextNumber: true },
    });
    for (const seed of SEEDS) {
      for (const [typeId, issued] of Object.entries(seed.issued)) {
        const row = sequences.find((s) => s.companyId === companyIds[seed.key] && s.typeId === typeId);
        expect(row?.nextNumber, `${seed.key} ${typeId}`).toBe(issued.length + 1);
      }
    }
  });

  it('numbers the next document of every running series with no gap and no duplicate, keeping or switching its format per country', async () => {
    const expected: [string, string, number, string][] = [
      // Kept: a compliant running series continues unchanged.
      ['fr', 'invoice', 4, `FAC-${YEAR}-00004`],
      // Switched: 21 characters breaks Chorus Pro's B2G limit; the counter goes on at 3.
      ['fr', 'credit-note', 3, `CN-${YEAR}-0003`],
      ['it', 'invoice', 3, `INVOICE-${YEAR}-0003`],
      // Switched: FatturaPA's <Numero> holds 20 characters. Issue #496's own case.
      ['it', 'credit-note', 2, `CN-${YEAR}-0002`],
      // Kept: the per-year ATCUD series this company registered with the AT.
      ['pt', 'invoice', 3, `FT ${YEAR}/0003`],
      // Never numbered: the country format, from 1.
      ['de', 'invoice', 1, `INVOICE-${YEAR}-0001`],
      ['pt', 'credit-note', 1, 'NC A/0001'],
      ['pl', 'quote', 3, `QUOTE-${YEAR}-0003`],
    ];
    for (const [key, typeId, number, displayNumber] of expected) {
      expect(await numberNext(key, typeId), `${key} ${typeId}`).toEqual({ number, displayNumber });
    }

    for (const seed of SEEDS) {
      const docs = await prisma.documentInstance.findMany({
        where: { companyId: companyIds[seed.key], number: { not: null } },
        select: { typeId: true, number: true, displayNumber: true },
      });
      for (const typeId of new Set(docs.map((d) => d.typeId))) {
        const ofType = docs.filter((d) => d.typeId === typeId);
        const numbers = ofType.map((d) => d.number as number).sort((a, b) => a - b);
        // No gap: 1..n exactly.
        expect(numbers, `${seed.key} ${typeId}`).toEqual(numbers.map((_, i) => i + 1));
        // No duplicate: every printed number distinct.
        expect(new Set(ofType.map((d) => d.displayNumber)).size, `${seed.key} ${typeId}`).toBe(ofType.length);
      }
    }
  });
});

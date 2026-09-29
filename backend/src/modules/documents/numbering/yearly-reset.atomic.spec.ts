/**
 * Issue #515 - the REAL-DATABASE proof that a `reset: "yearly"` counter can never hand out the same
 * number twice, and that turning the feature on changes NO number already issued.
 *
 * Same "a mock proves nothing about the DB engine's own behavior" posture `sequence.live.spec.ts` and
 * `sequence.atomic.spec.ts` already hold for the pre-existing counter - see each file's own header.
 * Ungated, like `sequence.atomic.spec.ts` (never like `sequence.live.spec.ts`, which needs an opt-in
 * flag): this only needs the SAME Postgres the `backend-tests` CI job already provisions for every
 * other non-`.live` spec that touches a real Prisma client, so there is nothing to skip by default -
 * and a "yearly reset never duplicates a number" claim is exactly the kind of claim MEMORY warns
 * against ever trusting from a mock alone.
 *
 * Two concerns, two describe blocks:
 *  - CONCURRENCY: `bumpSequence`/`takeDocumentNumber` called through real, concurrent Postgres
 *    connections, never a single Node process pretending to be two callers.
 *  - MIGRATION / REAL DATA SHAPES: a `DocumentNumberSequence` row seeded the way it looked BEFORE this
 *    feature (no `year` column touched, i.e. Prisma's own `@default(0)` fills it) proves the ALTER
 *    TABLE migration (`20260928140252_issue_515_yearly_numbering_reset`) changes nothing about an
 *    already-running continuous counter, and that a `reset: "yearly"` document dated before the
 *    cutover keeps reading that SAME row rather than silently starting a new one.
 */
import { vi } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { periodKeyFor, YEARLY_RESET_STARTS_FROM_YEAR } from './company-number-format';
import { bumpSequence, takeDocumentNumber } from './sequence';

async function createTestCompany(): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Yearly reset concurrency test ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `yearly-reset-test-${Date.now()}-${Math.random()}@example.com`,
    },
    select: { id: true },
  });
  return company.id;
}

describe('numbering/sequence.ts + company-number-format.ts - issue #515, real concurrent Postgres', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  let companyId: string;

  beforeEach(async () => {
    companyId = await createTestCompany();
  });

  afterEach(async () => {
    // Cascades to DocumentNumberSequence and DocumentInstance rows for this company (both declare
    // `onDelete: Cascade` on their companyId relation) - a fresh company per test, same discipline
    // `sequence.atomic.spec.ts`/`sequence.live.spec.ts` already hold.
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  describe('concurrency', () => {
    it('N simultaneous bumps of the SAME (company, type, year) still hand out exactly 1..N - no duplicate, no gap', async () => {
      const CONCURRENCY = 30;
      const year = YEARLY_RESET_STARTS_FROM_YEAR;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => bumpSequence(prisma, companyId, 'invoice', year)),
      );

      expect(new Set(results).size).toBe(CONCURRENCY);
      expect(results.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
      );
    });

    it('two different years of the SAME (company, type) never interfere with each other - each starts at 1', async () => {
      const [y2027a, y2028a, y2027b, y2028b] = await Promise.all([
        bumpSequence(prisma, companyId, 'invoice', 2027),
        bumpSequence(prisma, companyId, 'invoice', 2028),
        bumpSequence(prisma, companyId, 'invoice', 2027),
        bumpSequence(prisma, companyId, 'invoice', 2028),
      ]);

      expect([y2027a, y2027b].sort((a, b) => a - b)).toEqual([1, 2]);
      expect([y2028a, y2028b].sort((a, b) => a - b)).toEqual([1, 2]);
    });

    // THE CENTRAL PROOF issue #515 asks for: a mixed batch of documents, some dated in the OLD
    // (pre-cutover) year and some in a NEW (yearly-reset) year, all numbered at once through the real
    // `takeDocumentNumber` path (never `bumpSequence` alone) - proving the FULL pipeline, format
    // resolution included, never hands out the same displayNumber twice, whichever row each document
    // actually lands on.
    it('a mixed batch of old-year and new-year documents, numbered concurrently, never collide - not within a year and not across years', async () => {
      const FR_INVOICE_PATTERN = 'INVOICE-{year}-{number:4}'; // FR's own shipped pattern (reset: "yearly")
      const oldYearDate = new Date('2026-12-15'); // before the cutover - the pre-existing continuous row
      const newYearDate = new Date(`${YEARLY_RESET_STARTS_FROM_YEAR}-02-01`); // after it - its own fresh row

      const docs = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          prisma.documentInstance.create({
            data: {
              companyId,
              typeId: 'invoice',
              status: 'sent',
              data: { issueDate: (i % 2 === 0 ? oldYearDate : newYearDate).toISOString().slice(0, 10) },
            },
            select: { id: true },
          }),
        ),
      );

      const results = await Promise.all(
        docs.map((doc, i) => {
          const issuedAt = i % 2 === 0 ? oldYearDate : newYearDate;
          const year = periodKeyFor({ reset: 'yearly' }, issuedAt);
          return takeDocumentNumber(companyId, 'invoice', doc.id, FR_INVOICE_PATTERN, issuedAt, year);
        }),
      );

      const displayNumbers = results.map((r) => r?.displayNumber);
      expect(displayNumbers.every(Boolean)).toBe(true);
      // THE UNIQUENESS PROOF: no two documents - old year or new year - ever printed the same number.
      expect(new Set(displayNumbers).size).toBe(displayNumbers.length);

      const oldYearNumbers = displayNumbers.filter((d) => d?.startsWith('INVOICE-2026-'));
      const newYearNumbers = displayNumbers.filter((d) =>
        d?.startsWith(`INVOICE-${YEARLY_RESET_STARTS_FROM_YEAR}-`),
      );
      expect(oldYearNumbers).toHaveLength(10);
      expect(newYearNumbers).toHaveLength(10);
      // Each half is independently a contiguous 1..10 - the two years never shared, stole from, or
      // skipped a number in the other's counter.
      const numberOf = (d: string) => Number.parseInt(d.split('-').pop() as string, 10);
      expect(oldYearNumbers.map(numberOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(newYearNumbers.map(numberOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    // Issue #515's own edge case, quoted: "a document dated 31 December but numbered in January
    // belongs to the old year". Proven here against a REAL race: the old year's counter already has
    // documents in flight (concurrent with a NEW year's first documents) when a late, December-dated
    // document is numbered well after 1 January - it must land in the OLD year's row, never the new
    // one, and never collide with either.
    it('a document dated in the old year, numbered well after the new year started, still continues the OLD row without colliding', async () => {
      const decemberDate = new Date('2026-12-31');
      const newYearDate = new Date(`${YEARLY_RESET_STARTS_FROM_YEAR}-01-05`);
      const pattern = 'INVOICE-{year}-{number:4}';

      // The new year already has documents flowing through it - a realistic "the late December
      // document arrives after the office has already numbered several January invoices" scenario.
      const earlyNewYearDocs = await Promise.all(
        Array.from({ length: 5 }, () =>
          prisma.documentInstance.create({
            data: { companyId, typeId: 'invoice', status: 'sent', data: { issueDate: '2027-01-05' } },
            select: { id: true },
          }),
        ),
      );
      await Promise.all(
        earlyNewYearDocs.map((doc) =>
          takeDocumentNumber(
            companyId,
            'invoice',
            doc.id,
            pattern,
            newYearDate,
            periodKeyFor({ reset: 'yearly' }, newYearDate),
          ),
        ),
      );

      // The old (December-dated) document, numbered NOW, concurrently with one more new-year one.
      const [decDoc, oneMoreNewYearDoc] = await Promise.all([
        prisma.documentInstance.create({
          data: { companyId, typeId: 'invoice', status: 'sent', data: { issueDate: '2026-12-31' } },
          select: { id: true },
        }),
        prisma.documentInstance.create({
          data: { companyId, typeId: 'invoice', status: 'sent', data: { issueDate: '2027-01-06' } },
          select: { id: true },
        }),
      ]);

      const [decResult, newYearResult] = await Promise.all([
        takeDocumentNumber(
          companyId,
          'invoice',
          decDoc.id,
          pattern,
          decemberDate,
          periodKeyFor({ reset: 'yearly' }, decemberDate),
        ),
        takeDocumentNumber(
          companyId,
          'invoice',
          oneMoreNewYearDoc.id,
          pattern,
          newYearDate,
          periodKeyFor({ reset: 'yearly' }, newYearDate),
        ),
      ]);

      // The December document is the FIRST of the old (year 0) row for THIS company - "1", not "6":
      // the new year's traffic never touched it.
      expect(decResult?.displayNumber).toBe('INVOICE-2026-0001');
      // The new year's sixth document (five already numbered above) - continuous, no gap.
      expect(newYearResult?.displayNumber).toBe(`INVOICE-${YEARLY_RESET_STARTS_FROM_YEAR}-0006`);

      const allNumbers = [
        decResult?.displayNumber,
        newYearResult?.displayNumber,
        ...(
          await prisma.documentInstance.findMany({
            where: { companyId, id: { in: earlyNewYearDocs.map((d) => d.id) } },
            select: { displayNumber: true },
          })
        ).map((d) => d.displayNumber),
      ];
      expect(new Set(allNumbers).size).toBe(allNumbers.length);
    });
  });

  describe('migration / real data shapes', () => {
    // Proves the schema migration itself: a row seeded the way EVERY row looked before this feature
    // (no `year` column named at all) still gets Prisma's own `@default(0)` - the sentinel this file's
    // header calls "the one continuous counter every type used before this feature" - and behaves
    // EXACTLY as it always did: no issued number changes, the next bump is a plain increment.
    it('a pre-existing row (seeded the OLD way, no year column named) keeps its counter untouched at year 0', async () => {
      // The exact shape #496's own migration left behind for a company already numbering invoices:
      // `INSERT INTO "DocumentNumberSequence" ("companyId", "typeId", "nextNumber") VALUES (...)`,
      // never naming `year` - proving the column really does default rather than requiring a backfill.
      await prisma.$executeRaw`
        INSERT INTO "DocumentNumberSequence" ("companyId", "typeId", "nextNumber")
        VALUES (${companyId}, 'invoice', 154)
      `;

      const row = await prisma.documentNumberSequence.findUniqueOrThrow({
        where: { companyId_typeId_year: { companyId, typeId: 'invoice', year: 0 } },
      });
      expect(row.nextNumber).toBe(154);

      // A document dated well before the cutover reads and continues THIS exact row - "154", the
      // number this pre-existing counter already stood at, never "1".
      const oldDate = new Date('2026-11-20');
      const doc = await prisma.documentInstance.create({
        data: { companyId, typeId: 'invoice', status: 'sent', data: { issueDate: '2026-11-20' } },
        select: { id: true },
      });
      const result = await takeDocumentNumber(
        companyId,
        'invoice',
        doc.id,
        'INVOICE-{year}-{number:4}',
        oldDate,
        periodKeyFor({ reset: 'yearly' }, oldDate),
      );
      expect(result).toEqual({ number: 154, displayNumber: 'INVOICE-2026-0154' });

      // No new row was created for the old year - still exactly the one row this test seeded.
      const rows = await prisma.documentNumberSequence.findMany({ where: { companyId, typeId: 'invoice' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ year: 0, nextNumber: 155 });
    });

    // The counterpart: the SAME pre-existing row, at the SAME position (154), with a document dated ON
    // the cutover date - the row a `reset: "yearly"` company that has been running continuously since
    // before #515 shipped actually sees in production on day one.
    it('the first document dated on or after the cutover opens a brand-new row, leaving the old one exactly where it stood', async () => {
      await prisma.$executeRaw`
        INSERT INTO "DocumentNumberSequence" ("companyId", "typeId", "nextNumber")
        VALUES (${companyId}, 'invoice', 154)
      `;

      const cutoverDate = new Date(`${YEARLY_RESET_STARTS_FROM_YEAR}-01-01`);
      const doc = await prisma.documentInstance.create({
        data: {
          companyId,
          typeId: 'invoice',
          status: 'sent',
          data: { issueDate: `${YEARLY_RESET_STARTS_FROM_YEAR}-01-01` },
        },
        select: { id: true },
      });
      const result = await takeDocumentNumber(
        companyId,
        'invoice',
        doc.id,
        'INVOICE-{year}-{number:4}',
        cutoverDate,
        periodKeyFor({ reset: 'yearly' }, cutoverDate),
      );
      expect(result).toEqual({ number: 1, displayNumber: `INVOICE-${YEARLY_RESET_STARTS_FROM_YEAR}-0001` });

      const rows = await prisma.documentNumberSequence.findMany({
        where: { companyId, typeId: 'invoice' },
        orderBy: { year: 'asc' },
      });
      expect(rows).toEqual([
        { companyId, typeId: 'invoice', year: 0, nextNumber: 154 }, // untouched - no issued number changed
        { companyId, typeId: 'invoice', year: YEARLY_RESET_STARTS_FROM_YEAR, nextNumber: 2 },
      ]);
    });

    it('a "reset: never" counter never opens a year > 0 row, whatever the document date - idempotent with year 0 forever', async () => {
      const dates = ['2025-01-01', '2026-06-15', `${YEARLY_RESET_STARTS_FROM_YEAR}-03-01`, '2030-12-31'];
      const results = [];
      for (const iso of dates) {
        const doc = await prisma.documentInstance.create({
          data: { companyId, typeId: 'invoice', status: 'sent', data: { issueDate: iso } },
          select: { id: true },
        });
        results.push(
          await takeDocumentNumber(
            companyId,
            'invoice',
            doc.id,
            'INVOICE-{year}-{number:4}',
            new Date(iso),
            periodKeyFor({ reset: 'never' }, new Date(iso)), // e.g. PL/PT, or an unconstrained type
          ),
        );
      }

      expect(results.map((r) => r?.number)).toEqual([1, 2, 3, 4]);
      const rows = await prisma.documentNumberSequence.findMany({ where: { companyId, typeId: 'invoice' } });
      expect(rows).toEqual([{ companyId, typeId: 'invoice', year: 0, nextNumber: 5 }]);
    });
  });
});

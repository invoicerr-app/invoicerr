/**
 * Issue #539 - the REAL-DATABASE proof that a company's kept running series with NO `{year}` token
 * never restarts at the 2027 yearly-reset cutover (#515), even under real concurrent Postgres
 * connections spanning the cutover itself - and the counterpart, that a kept series which DOES carry
 * `{year}` still restarts, exactly as #515 intends.
 *
 * Same "a mock proves nothing about the DB engine's own behavior" posture `sequence.live.spec.ts`,
 * `sequence.atomic.spec.ts` and `yearly-reset.atomic.spec.ts` already hold for their own claims - see
 * each file's own header. Ungated, like the other two `.atomic.spec.ts` files (never like
 * `sequence.live.spec.ts`): this only needs the SAME Postgres the `backend-tests` CI job already
 * provisions for every other non-`.live` spec that touches a real Prisma client.
 *
 * Runs through `take-number.ts#takeDocumentNumberForTransition` - the SAME entry point
 * `documents.service.ts#runAction` calls - never `sequence.ts#bumpSequence`/`takeDocumentNumber`
 * directly: the bug this issue fixes lives in `company-number-format.ts#resolveNumberFormatFor`'s
 * format RESOLUTION, so a test calling straight into `sequence.ts` (as `yearly-reset.atomic.spec.ts`
 * mostly does) would never exercise the code path that used to be wrong.
 */
import { vi } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { resolveCompanyNumberFormat, YEARLY_RESET_STARTS_FROM_YEAR } from './company-number-format';
import { takeDocumentNumberForTransition } from './take-number';

async function createFrenchCompanyWithRunningSeries(typeId: string, pattern: string): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Kept series year guard test ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `kept-series-539-${Date.now()}-${Math.random()}@example.com`,
      // The shape `20260928000000_issue_496_freeze_running_number_series` leaves behind for a company
      // that had already numbered documents of this type before #496: one entry, holding the pattern
      // that series ran under.
      numberFormats: { [typeId]: pattern },
    },
    select: { id: true },
  });
  return company.id;
}

async function numberOneDocument(companyId: string, typeId: string, issueDate: string) {
  const doc = await prisma.documentInstance.create({
    data: { companyId, typeId, status: 'draft', data: { issueDate } },
    select: { id: true },
  });
  return takeDocumentNumberForTransition(companyId, typeId, doc.id, { issueDate });
}

describe('numbering - issue #539, a kept running series without {year} never restarts (real Postgres)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  let companyId: string;

  afterEach(async () => {
    // Cascades to DocumentNumberSequence and DocumentInstance rows for this company (both declare
    // `onDelete: Cascade` on their companyId relation) - same discipline every other real-Postgres
    // numbering spec in this directory already holds.
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  describe('a kept "FAC-{number}" series (no {year} token) - FR invoice, country reset is "yearly"', () => {
    beforeEach(async () => {
      companyId = await createFrenchCompanyWithRunningSeries('invoice', 'FAC-{number}');
    });

    it('documents dated 2026-12 and 2027-01, numbered one after another, never collide - the kept prefix, one continuous counter', async () => {
      const decResult = await numberOneDocument(companyId, 'invoice', '2026-12-15');
      const janResult = await numberOneDocument(
        companyId,
        'invoice',
        `${YEARLY_RESET_STARTS_FROM_YEAR}-01-15`,
      );

      // `{number}` pads to 4 digits by default (`format-number.ts`'s own convention) - "FAC-0001", not
      // "FAC-1".
      expect(decResult?.displayNumber).toBe('FAC-0001');
      // THE BUG THIS ISSUE FIXES: before the fix, this document opened a fresh year-2027 row and
      // ALSO printed "FAC-0001" - the exact duplicate of the document numbered above. With the fix,
      // the kept series' reset is forced to "never", so the SAME row 0 continues.
      expect(janResult?.displayNumber).toBe('FAC-0002');
      expect(decResult?.displayNumber).not.toBe(janResult?.displayNumber);

      const rows = await prisma.documentNumberSequence.findMany({
        where: { companyId, typeId: 'invoice' },
      });
      // No new year-2027 row was ever opened - unlike a country-format "yearly" series, this kept
      // series has exactly one row, forever.
      expect(rows).toEqual([{ companyId, typeId: 'invoice', year: 0, nextNumber: 3 }]);
    });

    it('concurrent numbering of a batch spanning the 2027 cutover still hands out 1..N with no gap and no duplicate', async () => {
      const CONCURRENCY = 20;
      const dates = Array.from({ length: CONCURRENCY }, (_, i) =>
        i % 2 === 0 ? '2026-12-20' : `${YEARLY_RESET_STARTS_FROM_YEAR}-01-20`,
      );
      const docs = await Promise.all(
        dates.map((issueDate) =>
          prisma.documentInstance.create({
            data: { companyId, typeId: 'invoice', status: 'draft', data: { issueDate } },
            select: { id: true },
          }),
        ),
      );

      const results = await Promise.all(
        docs.map((doc, i) =>
          takeDocumentNumberForTransition(companyId, 'invoice', doc.id, { issueDate: dates[i] }),
        ),
      );

      const displayNumbers = results.map((r) => r?.displayNumber);
      expect(displayNumbers.every(Boolean)).toBe(true);
      // THE UNIQUENESS PROOF: no two documents - pre-cutover or post-cutover - ever printed the same
      // "FAC-N".
      expect(new Set(displayNumbers).size).toBe(CONCURRENCY);
      expect(
        displayNumbers.map((d) => Number.parseInt((d as string).split('-')[1], 10)).sort((a, b) => a - b),
      ).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));

      const rows = await prisma.documentNumberSequence.findMany({
        where: { companyId, typeId: 'invoice' },
      });
      expect(rows).toEqual([{ companyId, typeId: 'invoice', year: 0, nextNumber: CONCURRENCY + 1 }]);
    });
  });

  describe('a kept series that DOES contain {year} - restarts yearly, as #515 intends', () => {
    beforeEach(async () => {
      companyId = await createFrenchCompanyWithRunningSeries('invoice', 'FACT-{year}-{number:5}');
    });

    it('a document dated 2026-12 and one dated 2027-01 land on two different, independent counters', async () => {
      const decResult = await numberOneDocument(companyId, 'invoice', '2026-12-15');
      const janResult = await numberOneDocument(
        companyId,
        'invoice',
        `${YEARLY_RESET_STARTS_FROM_YEAR}-01-15`,
      );

      expect(decResult?.displayNumber).toBe('FACT-2026-00001');
      expect(janResult?.displayNumber).toBe(`FACT-${YEARLY_RESET_STARTS_FROM_YEAR}-00001`);

      const rows = await prisma.documentNumberSequence.findMany({
        where: { companyId, typeId: 'invoice' },
        orderBy: { year: 'asc' },
      });
      expect(rows).toEqual([
        { companyId, typeId: 'invoice', year: 0, nextNumber: 2 },
        { companyId, typeId: 'invoice', year: YEARLY_RESET_STARTS_FROM_YEAR, nextNumber: 2 },
      ]);
    });
  });

  describe('break and restore - what #539 looked like before this fix', () => {
    beforeEach(async () => {
      companyId = await createFrenchCompanyWithRunningSeries('invoice', 'FAC-{number}');
    });

    // This test does NOT patch the fix out - see this PR's own description for the real
    // break-and-restore run (the fix reverted in the working tree, this exact scenario re-run to show
    // the duplicate, then the fix restored and the suite re-run green). What it DOES prove, on every
    // CI run from now on: `periodKeyFor` is fed the RESOLVED format's `reset` (which issue #539 makes
    // aware of the running series' own pattern), never the country format's `reset` directly - so a
    // future regression that goes back to reading `resolveCompanyNumberFormat`'s `countryPattern`-based
    // reset instead of its own `reset` field would fail this exact assertion.
    it('the resolved format actually used to number this series reports reset "never", not the country\'s own "yearly"', async () => {
      const resolved = await resolveCompanyNumberFormat(companyId, 'invoice');
      expect(resolved).toMatchObject({ pattern: 'FAC-{number}', source: 'running-series', reset: 'never' });
    });
  });
});

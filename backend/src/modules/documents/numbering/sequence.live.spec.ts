/**
 * The REAL concurrency proof — see sequence.ts's own header for why the atomicity choice
 * (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, no outer `Serializable` transaction needed) is
 * only actually PROVEN against a real, concurrent Postgres: two `Promise.all`-fired calls against a
 * mocked Prisma client would just run sequentially in this single Node process and prove nothing —
 * exactly the false-green shape MEMORY warns about for this repository (see e.g. the KSeF mock-tests
 * note). A naive read-then-write implementation is expected to lose updates or hand out the same
 * number twice under real concurrent connections; this file is what would catch that regression.
 *
 * Opt-in and skipped by default, the same pattern `send-quote.live.spec.ts` already uses for a real
 * Mailpit round-trip: the offline `backend-tests` CI job has no DATABASE_URL at all, so an unguarded
 * version of this file would hang or fail there on every PR.
 *
 *   DOCUMENTS_NUMBERING_LIVE_DB=1 npx jest sequence.live --no-coverage
 *
 * (run against whatever DATABASE_URL is already configured — invoicerr_dev in this repo's own dev
 * setup; a fresh checkout would point this at its own local Postgres).
 */
import prisma from '@/prisma/prisma.service';

import { bumpSequence, takeDocumentNumber } from './sequence';

const live = process.env.DOCUMENTS_NUMBERING_LIVE_DB === '1';
const describeLive = live ? describe : describe.skip;

async function createTestCompany(): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Numbering concurrency test ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `numbering-test-${Date.now()}@example.com`,
    },
    select: { id: true },
  });
  return company.id;
}

describeLive('numbering/sequence.ts — real concurrent Postgres', () => {
  jest.setTimeout(30_000);

  let companyId: string;

  beforeEach(async () => {
    companyId = await createTestCompany();
  });

  afterEach(async () => {
    // Cascades to DocumentNumberSequence and DocumentInstance rows for this company (both declare
    // `onDelete: Cascade` on their companyId relation) — a fresh company per test is what makes this
    // file safe to re-run without ever needing to hand-clean a shared fixture.
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('two SIMULTANEOUS bumpSequence calls for the same (company, type) never return the same number', async () => {
    const [a, b] = await Promise.all([
      bumpSequence(prisma, companyId, 'invoice'),
      bumpSequence(prisma, companyId, 'invoice'),
    ]);

    expect(a).not.toBe(b);
    expect([a, b].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  // A larger batch: the two-call case above can pass by luck if an implementation is "usually"
  // fine; a wider fan-out (well past what a single Postgres round-trip can serialize by accident)
  // makes a real race far more likely to be EXHIBITED, not just theoretically possible. Asserting the
  // full, contiguous 1..N set (not just "no duplicates") also catches a LOST update — a naive
  // read-then-write can silently drop a concurrent increment, producing fewer distinct values than
  // calls, which a bare uniqueness check alone would miss.
  it('N simultaneous bumps hand out exactly the numbers 1..N — no duplicates, no gaps, no lost updates', async () => {
    const CONCURRENCY = 30;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => bumpSequence(prisma, companyId, 'invoice')),
    );

    expect(new Set(results).size).toBe(CONCURRENCY);
    expect(results.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
    );
  });

  it('two different (company, type) sequences never interfere with each other', async () => {
    const [invoiceA, quoteA, invoiceB, quoteB] = await Promise.all([
      bumpSequence(prisma, companyId, 'invoice'),
      bumpSequence(prisma, companyId, 'quote'),
      bumpSequence(prisma, companyId, 'invoice'),
      bumpSequence(prisma, companyId, 'quote'),
    ]);

    expect([invoiceA, invoiceB].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([quoteA, quoteB].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('takeDocumentNumber end to end: two documents sent at once never receive the same displayNumber', async () => {
    const [docA, docB] = await Promise.all([
      prisma.documentInstance.create({
        data: { companyId, typeId: 'invoice', status: 'sent', data: {} },
        select: { id: true },
      }),
      prisma.documentInstance.create({
        data: { companyId, typeId: 'invoice', status: 'sent', data: {} },
        select: { id: true },
      }),
    ]);

    const [resultA, resultB] = await Promise.all([
      takeDocumentNumber(companyId, 'invoice', docA.id, 'INVOICE-{year}-{number:4}', new Date('2026-01-01')),
      takeDocumentNumber(companyId, 'invoice', docB.id, 'INVOICE-{year}-{number:4}', new Date('2026-01-01')),
    ]);

    expect(resultA?.number).not.toBe(resultB?.number);
    expect([resultA?.displayNumber, resultB?.displayNumber].sort()).toEqual(
      ['INVOICE-2026-0001', 'INVOICE-2026-0002'].sort(),
    );

    // What is actually IN THE DATABASE, not just what the function returned — the same discipline
    // this branch's own e2e specs hold ("l'assertion qui compte lit l'API, jamais une relecture du
    // DOM comme preuve de la base").
    const [rowA, rowB] = await Promise.all([
      prisma.documentInstance.findUniqueOrThrow({ where: { id: docA.id } }),
      prisma.documentInstance.findUniqueOrThrow({ where: { id: docB.id } }),
    ]);
    expect(rowA.number).not.toBeNull();
    expect(rowB.number).not.toBeNull();
    expect(rowA.number).not.toBe(rowB.number);
  });

  it('a SECOND call for an already-numbered document never takes (or wastes) another number', async () => {
    const doc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sent', data: {} },
      select: { id: true },
    });

    const first = await takeDocumentNumber(companyId, 'invoice', doc.id, 'INVOICE-{year}-{number:4}');
    expect(first?.number).toBe(1);

    const second = await takeDocumentNumber(companyId, 'invoice', doc.id, 'INVOICE-{year}-{number:4}');
    expect(second).toBeUndefined();

    // The sequence itself was NOT advanced by the refused second call — the next FRESH document
    // still gets 2, not 3. This is what proves the rollback in takeDocumentNumber's own transaction
    // actually undoes the sequence bump, not just refuses to report it.
    const other = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sent', data: {} },
      select: { id: true },
    });
    const third = await takeDocumentNumber(companyId, 'invoice', other.id, 'INVOICE-{year}-{number:4}');
    expect(third?.number).toBe(2);
  });
});

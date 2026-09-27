/**
 * The REAL-DATABASE proof for `takeDocumentNumberWithStatusTransition`'s own atomicity claim (PR #473
 * review point 1) - the mock-level tests in `actions/async-send.spec.ts` only prove the ORCHESTRATION
 * (this function gets called, with the right arguments, at the right moment); they cannot prove the
 * transaction itself is atomic, since a mocked call never runs a real Postgres transaction at all.
 * This file forces a genuine failure INSIDE the transaction, after the status write has executed but
 * before the number is committed, and reads the row back from a real database to prove the whole
 * thing rolled back together - never a real database, no way to prove a `$transaction` boundary
 * actually holds (the same "a mock proves nothing about the DB engine's own behavior" reasoning
 * `sequence.live.spec.ts` already documents for concurrency, applied here to atomicity instead).
 *
 * Ungated, unlike `sequence.live.spec.ts`: this only needs the SAME Postgres this worktree's own
 * `backend-tests` CI job (and every other non-`.live` spec touching real Prisma, e.g.
 * `documents.service.company-custom-fields.spec.ts`) already provisions - never an external live
 * service, so there is nothing to skip by default.
 *
 * PR #473 review point 2 (round 2) added the last test below: a genuine interleaving, two real
 * transactions run one after the other against the same row rather than a single forced failure -
 * the "stale caller" proof that a caller's own in-memory eligibility check (async-send.ts's
 * `eligibleForAtomicNumbering`) can never protect the database against on its own, only this
 * function's own re-check under the row lock can. A mock can assert this function was CALLED with
 * stale arguments; only a real transaction can prove what it then actually WRITES.
 */
import prisma from '@/prisma/prisma.service';

import { takeDocumentNumberWithStatusTransition } from './sequence';

async function createTestCompany(): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Sequence atomicity test ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `sequence-atomic-test-${Date.now()}-${Math.random()}@example.com`,
    },
    select: { id: true },
  });
  return company.id;
}

async function createDraftCreditNote(companyId: string): Promise<string> {
  const doc = await prisma.documentInstance.create({
    data: {
      companyId,
      typeId: 'credit-note',
      status: 'draft',
      data: { issueDate: '2026-09-20', currency: 'EUR', reason: 'Test.', lines: [] },
    },
    select: { id: true },
  });
  return doc.id;
}

describe('numbering/sequence.ts#takeDocumentNumberWithStatusTransition - real Postgres atomicity', () => {
  let companyId: string;

  beforeEach(async () => {
    companyId = await createTestCompany();
  });

  afterEach(async () => {
    // Cascades to DocumentNumberSequence and DocumentInstance rows for this company (both declare
    // `onDelete: Cascade` on their companyId relation) - a fresh company per test is what makes this
    // file safe to re-run without ever needing to hand-clean a shared fixture.
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('the success case: the status write and the number land TOGETHER', async () => {
    const documentId = await createDraftCreditNote(companyId);

    const result = await takeDocumentNumberWithStatusTransition(
      companyId,
      'credit-note',
      documentId,
      ['draft', 'send_failed'],
      'sending',
      { issueDate: '2026-09-20', currency: 'EUR', reason: 'Test.', lines: [] },
      'CREDIT-NOTE-{year}-{number:4}',
      new Date('2026-09-20'),
    );

    expect(result.document.status).toBe('sending');
    expect(result.numbered!.number).toBe(1);
    expect(result.numbered!.displayNumber).toBe('CREDIT-NOTE-2026-0001');

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('sending');
    expect(row.number).toBe(1);
    expect(row.displayNumber).toBe('CREDIT-NOTE-2026-0001');
  });

  // THE FORCED FAILURE: an invalid pattern (no "{number}" token at all) makes `formatDocumentNumber`
  // throw (`format-number.ts#assertValidNumberPattern`) AFTER the status `updateMany` and the sequence
  // `bumpSequence` have both already run inside the SAME transaction, but BEFORE the number is ever
  // written onto the document row - exactly the window PR #473 review point 1 closed. If the fix
  // holds, NOTHING commits: the row reads back exactly as it started, "draft" with no number, free to
  // retry with a valid pattern later. This is the real-database counterpart to the mock-level proof in
  // `actions/async-send.spec.ts`'s own "PR #473 review point 1" describe block.
  it('a forced failure AFTER the status write but BEFORE the number is written rolls back BOTH - the row is untouched', async () => {
    const documentId = await createDraftCreditNote(companyId);

    await expect(
      takeDocumentNumberWithStatusTransition(
        companyId,
        'credit-note',
        documentId,
        ['draft', 'send_failed'],
        'sending',
        { issueDate: '2026-09-20', currency: 'EUR', reason: 'Test.', lines: [] },
        'CREDIT-NOTE-NO-TOKEN-AT-ALL', // no "{number}" - assertValidNumberPattern throws
        new Date('2026-09-20'),
      ),
    ).rejects.toThrow(/no "\{number\}" token/);

    // THE PROOF: read back from a REAL, fresh Prisma call (not the same in-memory object) - the
    // transaction rolled back in full, both the status write and the sequence bump.
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('draft');
    expect(row.number).toBeNull();
    expect(row.displayNumber).toBeNull();

    // The sequence itself was never durably bumped either - a later, valid call still gets number 1,
    // never 2, proving `bumpSequence`'s own row was rolled back too, not merely the document one.
    const retried = await takeDocumentNumberWithStatusTransition(
      companyId,
      'credit-note',
      documentId,
      ['draft', 'send_failed'],
      'sending',
      { issueDate: '2026-09-20', currency: 'EUR', reason: 'Test.', lines: [] },
      'CREDIT-NOTE-{year}-{number:4}',
      new Date('2026-09-20'),
    );
    expect(retried.numbered!.number).toBe(1);
  });

  // THE INTERLEAVING (PR #473 review point 2, round 2): reproduces the double-click / two-tabs race
  // async-send.ts's own `eligibleForAtomicNumbering` cannot see, because it reads `existing.number`
  // from a snapshot taken BEFORE this transaction ever starts. Both "requests" below call this exact
  // function directly - never through async-send.ts's in-memory gate - which is the point: this test
  // proves the DATABASE-level guard holds even when a caller's own eligibility check is stale, the one
  // case the caller's own snapshot can never protect against by itself.
  it('a stale caller (B already numbered and failed) never renumbers, never bumps the sequence again, and never gaps it', async () => {
    const documentId = await createDraftCreditNote(companyId);
    const data = { issueDate: '2026-09-20', currency: 'EUR', reason: 'Test.', lines: [] };
    const pattern = 'CREDIT-NOTE-{year}-{number:4}';

    // "A" reads the draft here, in memory, seeing `number: null` - exactly like
    // `async-send.ts`'s own `findOwnedDocument` call, before either request's transaction has run.
    // Nothing to assert yet: the point is only that A's own decision to call this function at all
    // was made against a row that still looked unnumbered.

    // "B" wins the race first: numbers the document (draft -> sending) …
    const bSend = await takeDocumentNumberWithStatusTransition(
      companyId,
      'credit-note',
      documentId,
      ['draft', 'send_failed'],
      'sending',
      data,
      pattern,
      new Date('2026-09-20'),
    );
    expect(bSend.numbered!.number).toBe(1);
    // … then its delivery fails - the record moves on to "send_failed", KEEPING its number, exactly
    // what `mark-send-failed.ts` does in production (a plain status write, never touching `number`).
    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'send_failed' } });

    // "A" now runs its OWN call - the same `fromStatuses` async-send.ts always passes
    // (`['draft', 'send_failed']`), which "send_failed" satisfies: a legitimate retry must be let
    // through. Without the fix, this would ALSO bump the sequence and overwrite `number`/
    // `displayNumber`, renumbering B's already-delivered document.
    const aSend = await takeDocumentNumberWithStatusTransition(
      companyId,
      'credit-note',
      documentId,
      ['draft', 'send_failed'],
      'sending',
      data,
      pattern,
      new Date('2026-09-20'),
    );

    // THE PROOF: A's call still moves the status (a legitimate retry must proceed), but takes no
    // number of its own - `numbered` comes back undefined, the signal `async-send.ts` reads to skip
    // the stock effect and `onNumbered` (ATCUD) for this call.
    expect(aSend.numbered).toBeUndefined();
    expect(aSend.document.status).toBe('sending');
    expect(aSend.document.number).toBe(1);
    expect(aSend.document.displayNumber).toBe('CREDIT-NOTE-2026-0001');

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.number).toBe(1);
    expect(row.displayNumber).toBe('CREDIT-NOTE-2026-0001');

    // NO GAP: the sequence itself was never bumped a second time - the next document takes 2, never 3.
    const otherDocumentId = await createDraftCreditNote(companyId);
    const next = await takeDocumentNumberWithStatusTransition(
      companyId,
      'credit-note',
      otherDocumentId,
      ['draft', 'send_failed'],
      'sending',
      data,
      pattern,
      new Date('2026-09-20'),
    );
    expect(next.numbered!.number).toBe(2);
  });
});

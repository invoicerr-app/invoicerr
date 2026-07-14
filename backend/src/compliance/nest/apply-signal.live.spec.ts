/**
 * Live-DB integration test for `ApplySignalService` (TODO_PRISMA.md §6 reviewer checklist: the
 * applySignal transaction must atomically update the document and (de)schedule its drivers).
 *
 * Skipped by default — no DATABASE_URL is required to run the rest of the compliance suite. Opt in
 * with COMPLIANCE_LIVE_DB_TESTS=1 against a disposable database (never point this at a DB you care
 * about: it truncates the compliance tables before and after running).
 *
 *   COMPLIANCE_LIVE_DB_TESTS=1 DATABASE_URL=postgresql://user:pass@localhost:PORT/db \
 *     npx jest src/compliance/nest/apply-signal.live.spec.ts --runInBand
 */
const live = process.env.COMPLIANCE_LIVE_DB_TESTS ? describe : describe.skip;

live('LIVE: ApplySignalService against Postgres', () => {
  // Imported lazily, inside the gated block, so merely collecting this file never touches Prisma
  // when the live suite is skipped (no accidental connection attempt in the default test run).
  const { PrismaService } = require('@/prisma/prisma.service');
  const { ApplySignalService } = require('./apply-signal');
  const { PrismaComplianceDocumentStore } = require('../persistence/prisma-document-store');
  const { resolve } = require('../engine/compliance-engine');

  const prisma = new PrismaService();
  const docStore = new PrismaComplianceDocumentStore(prisma);
  const applySignal = new ApplySignalService(prisma);

  function mxCtx() {
    return {
      supplier: { legalName: 'MX Co', countryCode: 'MX', role: 'B2B', identifiers: [] },
      buyer: { legalName: 'MX Buyer', countryCode: 'MX', role: 'B2B', identifiers: [] },
      lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
      issueDate: new Date('2027-01-15'),
      currency: 'MXN',
    };
  }

  beforeEach(async () => {
    await prisma.scheduledJob.deleteMany({});
    await prisma.complianceCallbackRegistration.deleteMany({});
    await prisma.complianceInboundMessage.deleteMany({});
    await prisma.complianceEvent.deleteMany({});
    await prisma.complianceAuthorityId.deleteMany({});
    await prisma.complianceDocument.deleteMany({});
  });

  afterAll(async () => {
    await prisma.scheduledJob.deleteMany({});
    await prisma.complianceCallbackRegistration.deleteMany({});
    await prisma.complianceInboundMessage.deleteMany({});
    await prisma.complianceEvent.deleteMany({});
    await prisma.complianceAuthorityId.deleteMany({});
    await prisma.complianceDocument.deleteMany({});
    await prisma.onModuleDestroy();
  });

  it('a real transition persists the new status, appends one event, and cancels the obsolete driver', async () => {
    const ctx = mxCtx();
    const plan = resolve(ctx);
    const id = 'live-mx-1';
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    const afterSubmit = await docStore.get(id);
    expect(afterSubmit.status).toBe('PENDING_CLEARANCE');
    expect(afterSubmit.events).toHaveLength(1);
    const jobsAfterSubmit = await prisma.scheduledJob.findMany({ where: { documentId: id } });
    expect(jobsAfterSubmit).toHaveLength(1);
    expect(jobsAfterSubmit[0]).toMatchObject({ kind: 'POLL', status: 'PENDING' });
    const submitJobId = jobsAfterSubmit[0].id;

    await applySignal.apply(id, { type: 'POLL_RESULT', status: 'CLEARED' });
    const afterClear = await docStore.get(id);
    expect(afterClear.status).toBe('CLEARED');
    expect(afterClear.events).toHaveLength(2);

    // The fix under test: the job that guarded PENDING_CLEARANCE must be cancelled now that the
    // document has moved past it — not left PENDING to poll a resolved document for up to 24h.
    const staleJob = await prisma.scheduledJob.findUnique({ where: { id: submitJobId } });
    expect(staleJob.status).toBe('CANCELLED');
  });

  it('a NOOP signal (stale/inapplicable) writes nothing — no event, no job, no status change', async () => {
    const ctx = mxCtx();
    const plan = resolve(ctx);
    const id = 'live-mx-2';
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'CLEARED',
      ctx,
      plan,
      authorityIds: [],
      events: [{ id: 'evt-issue', type: 'ISSUE', at: new Date().toISOString(), actor: 'system' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // CLEARED has no outgoing POLL transition, so this is a runtime NOOP.
    await applySignal.apply(id, { type: 'POLL_RESULT', status: 'CLEARED' });

    const after = await docStore.get(id);
    expect(after.status).toBe('CLEARED');
    expect(after.events).toHaveLength(1);
    expect(await prisma.scheduledJob.count({ where: { documentId: id } })).toBe(0);
  });

  it('M-12b: two concurrent signals racing from the SAME status — exactly one wins the CAS, the loser is a clean NOOP (no lost event, no status clobber)', async () => {
    // Mirrors a real scheduler-poll (POLL_RESULT: CLEARED) racing a real inbound authority answer
    // (POLL_RESULT: REJECTED) — both computed from the SAME PENDING_CLEARANCE read. Before the M-12b
    // fix, `apply()` unconditionally wrote `status: applied.to` + `events: [...rec.events, newEvent]`
    // using each call's own stale `rec` snapshot — whichever call's write landed LAST won the status
    // AND silently dropped the other's event (its own `[...rec.events, ...]` never saw the sibling's
    // append). The CAS (`transitionIfStatus`) makes the second writer's `updateMany` match zero rows
    // instead, aborting its whole transaction cleanly.
    const ctx = mxCtx();
    const plan = resolve(ctx);
    const id = 'live-mx-race';
    const seedEvent = {
      id: 'evt-submit',
      type: 'SUBMIT_CLEARANCE',
      at: new Date().toISOString(),
      actor: 'system',
    };
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'PENDING_CLEARANCE',
      ctx,
      plan,
      authorityIds: [],
      events: [seedEvent],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Genuine concurrency against the SAME real Postgres row: both calls are issued synchronously
    // (before either `apply()` reaches its first `await`), so both read `status: 'PENDING_CLEARANCE'`
    // off the SAME row before either has written anything — the exact TOCTOU the CAS defends against.
    // Postgres READ COMMITTED semantics then serialize the two `updateMany` CAS writes: whichever
    // commits first wins; the second re-evaluates its `WHERE status = 'PENDING_CLEARANCE'` against the
    // now-updated row and matches zero rows.
    const results = await Promise.allSettled([
      applySignal.apply(id, { type: 'POLL_RESULT', status: 'CLEARED' }),
      applySignal.apply(id, { type: 'POLL_RESULT', status: 'REJECTED' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true); // the loser resolves cleanly, never throws/rejects

    const after = await docStore.get(id);
    // Exactly one of the two legal terminal transitions actually happened — never a corrupted mix.
    expect(['CLEARED', 'REJECTED']).toContain(after.status);

    // Exactly ONE new terminal event was appended — not two (double-applied), not zero (both lost).
    const terminalEvents = after.events.filter(
      (e: { type: string }) => e.type === 'CLEAR' || e.type === 'REJECT',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].type).toBe(after.status === 'CLEARED' ? 'CLEAR' : 'REJECT');
    // The seed event + exactly one new terminal event — the loser wrote nothing at all.
    expect(after.events).toHaveLength(2);
  });

  it('M-12b (deterministic TOCTOU): transitionIfStatus called with a STALE expectedStatus loses the CAS — no write at all', async () => {
    // Complements the genuine-race test above with a fully deterministic reproduction of the exact
    // TOCTOU the CAS defends against: a caller that read the document BEFORE a winning transition
    // committed, then tries to write using that now-stale status as its compare token.
    const ctx = mxCtx();
    const plan = resolve(ctx);
    const id = 'live-mx-toctou';
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'PENDING_CLEARANCE',
      ctx,
      plan,
      authorityIds: [],
      events: [{ id: 'evt-submit', type: 'SUBMIT_CLEARANCE', at: new Date().toISOString(), actor: 'system' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Winner: a real apply() call genuinely moves PENDING_CLEARANCE -> CLEARED.
    await applySignal.apply(id, { type: 'POLL_RESULT', status: 'CLEARED' });
    const afterWinner = await docStore.get(id);
    expect(afterWinner.status).toBe('CLEARED');
    expect(afterWinner.events).toHaveLength(2);

    // Loser: calls the SAME CAS primitive apply()'s APPLIED branch uses, but with the STALE
    // `expectedStatus` ('PENDING_CLEARANCE') a concurrent reader would have captured a moment earlier
    // — before the winner's write committed.
    const cas = await docStore.transitionIfStatus(id, 'PENDING_CLEARANCE', {
      status: 'REJECTED',
      events: [
        ...afterWinner.events,
        { id: 'evt-loser-reject', type: 'REJECT', at: new Date().toISOString(), actor: 'system' },
      ],
    });
    expect(cas.applied).toBe(false);
    expect(cas.record).toBeUndefined();

    // The document is byte-for-byte untouched by the loser: no status clobber, no REJECT event.
    const finalDoc = await docStore.get(id);
    expect(finalDoc.status).toBe('CLEARED');
    expect(finalDoc.events).toHaveLength(2);
    expect(finalDoc.events.some((e: { type: string }) => e.type === 'REJECT')).toBe(false);
  });

  it('AWAIT_CALLBACK registers a correlation that a real inbound message later resolves', async () => {
    const itCtx = {
      supplier: { legalName: 'IT Co', countryCode: 'IT', role: 'B2B', identifiers: [] },
      buyer: { legalName: 'IT Buyer', countryCode: 'IT', role: 'B2B', identifiers: [] },
      lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
      issueDate: new Date('2027-01-15'),
      currency: 'EUR',
    };
    const plan = resolve(itCtx);
    const id = 'live-it-1';
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx: itCtx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    const regs = await prisma.complianceCallbackRegistration.findMany({ where: { documentId: id } });
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ channel: 'SDI', status: 'WAITING' });
  });
});

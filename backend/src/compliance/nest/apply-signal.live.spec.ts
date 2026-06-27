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
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { PrismaService } = require('@/prisma/prisma.service');
  const { ApplySignalService } = require('./apply-signal');
  const { PrismaComplianceDocumentStore } = require('../persistence/prisma-document-store');
  const { resolve } = require('../engine/compliance-engine');
  /* eslint-enable @typescript-eslint/no-var-requires */

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
      id, kind: 'INVOICE', direction: 'OUTBOUND', status: 'ISSUED', ctx, plan,
      authorityIds: [], events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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
      id, kind: 'INVOICE', direction: 'OUTBOUND', status: 'CLEARED', ctx, plan,
      authorityIds: [], events: [{ id: 'evt-issue', type: 'ISSUE', at: new Date().toISOString(), actor: 'system' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    // CLEARED has no outgoing POLL transition, so this is a runtime NOOP.
    await applySignal.apply(id, { type: 'POLL_RESULT', status: 'CLEARED' });

    const after = await docStore.get(id);
    expect(after.status).toBe('CLEARED');
    expect(after.events).toHaveLength(1);
    expect(await prisma.scheduledJob.count({ where: { documentId: id } })).toBe(0);
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
      id, kind: 'INVOICE', direction: 'OUTBOUND', status: 'ISSUED', ctx: itCtx, plan,
      authorityIds: [], events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    const regs = await prisma.complianceCallbackRegistration.findMany({ where: { documentId: id } });
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ channel: 'SDI', status: 'WAITING' });
  });
});

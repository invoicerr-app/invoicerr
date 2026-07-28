import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { PartyRole } from '../../../types';
import { PartyTaxProfile, TransactionContext } from '../../../canonical/canonical-document';
import { resolve } from '../../../engine/compliance-engine';
import { PrismaComplianceDocumentStore } from '../../../persistence/prisma-document-store';
import { FormatProviderRegistry, defaultFormatRegistry } from '../../../providers/format/registry';
import { SigningProviderRegistry, defaultSigningRegistry } from '../../../providers/signing/registry';
import { TransmissionProviderRegistry } from '../../../providers/transmission/registry';
import { TransmissionProvider } from '../../../providers/transmission/transmission-provider';
import { ReportingRegistry, defaultReportingRegistry } from '../../../reporting/registry';
import { ComplianceWorkerModule } from '../compliance-worker.module';
import { ComplianceQueueDispatcher } from '../compliance-queue.dispatcher';
import { QueueModule } from '../queue.module';

/**
 * Phase 2 integration test (QUEUE_IMPL_PLAN.md §9/§11) — exercises the REAL Nest DI graph
 * (QueueModule + ComplianceWorkerModule, i.e. exactly what the dedicated worker process wires —
 * see worker.module.ts) against a real Redis (self-gated on REDIS_URL, same pattern as
 * queue-smoke.redis.spec.ts) and this dev environment's real local Postgres (DATABASE_URL, same DB
 * apply-signal.live.spec.ts uses — Prisma connects lazily, no separate gate needed).
 *
 * Deliberately named WITHOUT `redis.spec` so it is not picked up by the CI `queue-integration` job
 * (cypress.yml), which provisions Redis but NOT Postgres — this test needs both. It still self-skips
 * everywhere REDIS_URL is unset (i.e. every other CI job / default local `npm test`).
 *
 * Proves the F-3 fix end-to-end:
 *   enqueueTransmit -> TransmitProcessor (real executor + REAL DI-resolved, credentialed registry)
 *   -> ApplySignalService (ISSUED -> PENDING_CLEARANCE, SCHEDULE_POLL armed with transmitRef)
 *   -> post-commit projection enqueues compliance-poll
 *   -> PollProcessor polls the SAME credentialed registry with the EXTERNAL ref (not documentId)
 *   -> PENDING then CLEARED -> ApplySignalService (PENDING_CLEARANCE -> CLEARED).
 */
const hasRedis = !!process.env.REDIS_URL;
const describeWithRedis = hasRedis ? describe : describe.skip;

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

async function waitFor<T>(
  check: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await check();
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms (last value: ${JSON.stringify(last)})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describeWithRedis('Phase 2: real queue transmit -> poll -> CLEARED (F-3 proof)', () => {
  jest.setTimeout(30000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let docStore: PrismaComplianceDocumentStore;
  let dispatcher: ComplianceQueueDispatcher;
  let registry: TransmissionProviderRegistry;

  let pollCallCount = 0;
  let capturedPollRef: string | undefined;

  // Mock ASYNC_POLL provider standing in for MX's PAC channel (proven live wiring — Ksef/Pdp/Peppol/Sdi
  // internals are NOT touched by this test, only how a transmission is triggered/polled). Fast
  // policy (1s, no backoff) keeps the test's wall-clock time small.
  const mockPac: TransmissionProvider = {
    id: 'pac',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    pollPolicy: { everySeconds: 1, timeoutHours: 1, backoff: 'NONE' },
    transmit: async () => ({
      channel: 'PAC',
      status: 'PENDING',
      ref: 'phase2-mock-ref',
      notes: ['mock transmit accepted (PENDING — awaiting clearance)'],
    }),
    poll: async (ref: string) => {
      capturedPollRef = ref;
      pollCallCount += 1;
      const cleared = pollCallCount >= 2;
      return {
        channel: 'PAC',
        status: cleared ? 'CLEARED' : 'PENDING',
        notes: [`mock poll call #${pollCallCount}`],
        // Bug-fix proof (poll.processor.ts RESOLVE branch): a real authority (e.g. KSeF) returns its
        // identifiers alongside the CLEARED status; this must reach the document's persisted
        // authorityIds through the REAL PollProcessor -> ApplySignalService -> Postgres path, not just
        // a mocked/in-memory assertion.
        authorityIds: cleared ? [{ scheme: 'PAC_FOLIO', value: 'phase2-folio-999' }] : undefined,
      };
    },
  };

  beforeAll(async () => {
    // Override only the format/signing/reporting registries with their offline-safe defaults (the
    // same ones the offline `lifecycle-coherence.spec.ts`/`compliance-service.spec.ts` suites already
    // exercise for MX) — this test is about the QUEUE + REGISTRY wiring (F-3), not about exercising
    // real PDF/XML rendering or real cert signing (InvoiceRenderingService/SigningCertificatesService),
    // which are unrelated to Phase 2 and would make this test fragile for no benefit. The
    // TransmissionProviderRegistry itself is deliberately LEFT as the real DI factory output — that is
    // exactly the thing F-3 is about.
    moduleRef = await Test.createTestingModule({ imports: [QueueModule, ComplianceWorkerModule] })
      .overrideProvider(FormatProviderRegistry)
      .useValue(defaultFormatRegistry)
      .overrideProvider(SigningProviderRegistry)
      .useValue(defaultSigningRegistry)
      .overrideProvider(ReportingRegistry)
      .useValue(defaultReportingRegistry)
      .compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    docStore = moduleRef.get(PrismaComplianceDocumentStore);
    dispatcher = moduleRef.get(ComplianceQueueDispatcher);
    registry = moduleRef.get(TransmissionProviderRegistry);

    // F-3 assertion (automated regression guard): the registry shared by ComplianceExecutor,
    // ApplySignalService AND PollProcessor (all resolve the same DI token) must be the CREDENTIALED
    // one wired by ComplianceCoreModule (real ChannelCredentialsService) — never
    // `defaultTransmissionRegistry`, whose `.credentials` is always `undefined`
    // (providers/transmission/registry.ts: `new TransmissionProviderRegistry()`). If
    // ApplySignalService/PollProcessor's DI wiring ever regresses back to
    // `defaultTransmissionRegistry`, this assertion fails immediately; if it somehow didn't, the mock
    // 'pac' override below would never be seen by the poll path and the test below would time out
    // instead (belt-and-suspenders — verified manually during Phase 2 delivery).
    expect(registry.credentials).toBeDefined();

    // Inject the mock PAC provider into the REAL, DI-resolved, credentialed registry instance — same
    // technique already used by lifecycle-coherence.spec.ts's svcMx() helper.
    (registry as unknown as { byId: Map<string, TransmissionProvider> }).byId.set('pac', mockPac);
    (registry as unknown as { byChannel: Map<string, TransmissionProvider> }).byChannel.set('PAC', mockPac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('transmits, polls (PENDING then CLEARED) and advances the document through BullMQ', async () => {
    const ctx: TransactionContext = {
      supplier: party('MX', 'B2B'),
      buyer: party('MX', 'B2B'),
      lines: [
        { id: 'l1', description: 'phase2 widget', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' },
      ],
      issueDate: new Date('2027-01-15'),
      currency: 'MXN',
    };
    const plan = resolve(ctx);
    expect(plan.regime.blocking).toBe(true); // MX clearance — required so "accepted" => SUBMIT_CLEARANCE

    const id = `phase2-mx-${Date.now()}`;
    const nowIso = new Date().toISOString();

    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    try {
      await dispatcher.enqueueTransmit(id);

      // 1) TransmitProcessor: computeSendOutcome (accepted/PENDING, blocking) -> SUBMIT_CLEARANCE ->
      //    ApplySignalService: ISSUED -> PENDING_CLEARANCE, SCHEDULE_POLL armed (ref=phase2-mock-ref),
      //    post-commit projection enqueues compliance-poll.
      await waitFor(
        () => docStore.get(id),
        (d) => d?.status === 'PENDING_CLEARANCE',
        15000,
      );

      const pollRows = await prisma.scheduledJob.findMany({ where: { documentId: id, kind: 'POLL' } });
      expect(pollRows).toHaveLength(1);
      expect(pollRows[0].providerId).toBe('pac');

      // 2) PollProcessor: first poll -> PENDING -> RESCHEDULE (job.moveToDelayed, same jobId) ->
      //    second poll -> CLEARED -> ApplySignalService: PENDING_CLEARANCE -> CLEARED.
      await waitFor(
        () => docStore.get(id),
        (d) => d?.status === 'CLEARED',
        20000,
      );

      expect(pollCallCount).toBeGreaterThanOrEqual(2);
      // F-2-adjacent proof: poll() was called with the EXTERNAL transmit ref, never the raw documentId.
      expect(capturedPollRef).toBe('phase2-mock-ref');
      expect(capturedPollRef).not.toBe(id);

      // The poll job itself resolved the document (RESOLVE branch of decidePoll sets the ScheduledJob
      // row to DONE directly) — DONE, not CANCELLED (CANCELLED is for a driver superseded by a
      // DIFFERENT effect, e.g. a webhook resolving the document before this same poll could).
      const pollRowsAfter = await prisma.scheduledJob.findMany({ where: { documentId: id, kind: 'POLL' } });
      expect(pollRowsAfter[0].status).toBe('DONE');

      // Bug-fix proof: the CLEARED poll's authorityIds (mock PAC_FOLIO above) must have been persisted
      // on the document — real Postgres row, written by PollProcessor -> ApplySignalService, not a
      // mock/in-memory assertion.
      const clearedDoc = await docStore.get(id);
      expect(clearedDoc?.authorityIds).toEqual([{ scheme: 'PAC_FOLIO', value: 'phase2-folio-999' }]);
      const authRows = await prisma.complianceAuthorityId.findMany({ where: { documentId: id } });
      expect(authRows).toHaveLength(1);
      expect(authRows[0]).toMatchObject({ scheme: 'PAC_FOLIO', value: 'phase2-folio-999' });
    } finally {
      await prisma.scheduledJob.deleteMany({ where: { documentId: id } });
      await prisma.complianceCallbackRegistration.deleteMany({ where: { documentId: id } });
      await prisma.complianceEvent.deleteMany({ where: { documentId: id } });
      await prisma.complianceAuthorityId.deleteMany({ where: { documentId: id } });
      await prisma.complianceDocument.deleteMany({ where: { id } });
    }
  });
});

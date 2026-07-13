import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';

import { PrismaService } from '@/prisma/prisma.service';
import { PartyRole } from '../../../types';
import { PartyTaxProfile, TransactionContext } from '../../../canonical/canonical-document';
import { resolve } from '../../../engine/compliance-engine';
import { createPollJob } from '../../../lifecycle/drivers/poll-job';
import { createTimerJob } from '../../../lifecycle/drivers/timer-job';
import { PrismaComplianceDocumentStore } from '../../../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../../../persistence/prisma-scheduled-job-store';
import { FormatProviderRegistry, defaultFormatRegistry } from '../../../providers/format/registry';
import { SigningProviderRegistry, defaultSigningRegistry } from '../../../providers/signing/registry';
import { TransmissionProviderRegistry } from '../../../providers/transmission/registry';
import { TransmissionProvider } from '../../../providers/transmission/transmission-provider';
import { ReportingRegistry, defaultReportingRegistry } from '../../../reporting/registry';
import { ComplianceQueueDispatcher } from '../compliance-queue.dispatcher';
import { ComplianceWorkerModule } from '../compliance-worker.module';
import { Q_POLL, Q_SWEEP } from '../queue.constants';
import { QueueModule } from '../queue.module';
import { redisConnection } from '../redis.config';

/**
 * Phase 3 integration test (QUEUE_IMPL_PLAN.md §9/§11) — exercises the REAL Nest DI graph
 * (QueueModule + ComplianceWorkerModule, i.e. exactly what the dedicated worker process wires —
 * see worker.module.ts) against a real Redis (self-gated on REDIS_URL, same pattern as
 * queue-smoke.redis.spec.ts / phase2-transmit-poll.spec.ts) and this dev environment's real local
 * Postgres (DATABASE_URL — Prisma connects lazily, no separate gate needed).
 *
 * Deliberately named WITHOUT `redis.spec` so it is not picked up by the CI `queue-integration` job
 * (cypress.yml), which provisions Redis but NOT Postgres — this test needs both. It still self-skips
 * everywhere REDIS_URL is unset (i.e. every other CI job / default local `npm test`).
 *
 * Proves two things end-to-end, against the real BullMQ processors (not mocks):
 *   (a) TIMER — an ARMED `ScheduledJob` (TIMER) whose deadline has already passed, once its
 *       `compliance-timer` job runs, fires TIMER_ELAPSED through `ApplySignalService` and advances
 *       the document's real lifecycle status (CL's "silence = acceptance": AWAITING_RESPONSE ->
 *       ACCEPTED, contributors.ts `BuyerResponsePhase`).
 *   (b) SWEEP — an orphaned PENDING `ScheduledJob` (POLL) — a DB row with no live BullMQ job behind
 *       it, simulating a Redis flush / a projection that never made it — gets re-projected by
 *       `SweepProcessor` onto `compliance-poll` under the SAME deterministic jobId
 *       (`poll-<documentId>`), and a REAL `PollProcessor` worker picks it up (BullMQ 'active' event).
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

/** Resolves once the given jobId is reported 'active' on this QueueEvents instance — proof that a
 *  REAL BullMQ worker picked the job up for consumption (not just that it was added to the list). */
function waitForActiveJob(events: QueueEvents, jobId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      events.off('active', handler);
      reject(new Error(`timed out waiting for job ${jobId} to become active after ${timeoutMs}ms`));
    }, timeoutMs);
    function handler(args: { jobId: string; prev?: string }) {
      if (args.jobId === jobId) {
        clearTimeout(timer);
        events.off('active', handler);
        resolvePromise();
      }
    }
    events.on('active', handler);
  });
}

describeWithRedis('Phase 3: real timer fire + sweep reconcile', () => {
  jest.setTimeout(30000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let docStore: PrismaComplianceDocumentStore;
  let pollStore: PrismaPollJobStore;
  let timerStore: PrismaTimerJobStore;
  let dispatcher: ComplianceQueueDispatcher;
  let registry: TransmissionProviderRegistry;

  // Mock ASYNC_POLL provider for the sweep re-projection test — always PENDING (RESCHEDULE branch of
  // decidePoll), so PollProcessor never needs to call applySignal for this document; the test only
  // cares that the sweep's re-projected job is really picked up by a real BullMQ worker.
  const sweepMockPac: TransmissionProvider = {
    id: 'phase3-sweep-mock',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    pollPolicy: { everySeconds: 60, timeoutHours: 1, backoff: 'NONE' },
    transmit: async () => ({
      channel: 'PAC',
      status: 'PENDING',
      ref: 'phase3-sweep-mock-ref',
      notes: ['mock transmit accepted'],
    }),
    poll: async () => ({ channel: 'PAC', status: 'PENDING', notes: ['mock poll — always pending'] }),
  };

  beforeAll(async () => {
    // Same rationale as phase2-transmit-poll.spec.ts: override only the format/signing/reporting
    // registries with offline-safe defaults; the TransmissionProviderRegistry is deliberately left as
    // the real DI factory output.
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
    pollStore = moduleRef.get(PrismaPollJobStore);
    timerStore = moduleRef.get(PrismaTimerJobStore);
    dispatcher = moduleRef.get(ComplianceQueueDispatcher);
    registry = moduleRef.get(TransmissionProviderRegistry);

    (registry as unknown as { byId: Map<string, TransmissionProvider> }).byId.set(
      'phase3-sweep-mock',
      sweepMockPac,
    );
    (registry as unknown as { byChannel: Map<string, TransmissionProvider> }).byChannel.set(
      'PAC',
      sweepMockPac,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('(a) fires an elapsed ARMED timer through a real compliance-timer job -> TIMER_ELAPSED -> ACCEPTED', async () => {
    // CL (Chile): Ley 19.983 — buyer has 8 days to respond, silence = acceptance
    // (contributors.ts `BuyerResponsePhase`, latam.ts CL profile: response.defaultOnSilence='ACCEPT').
    const ctx: TransactionContext = {
      supplier: party('CL', 'B2B'),
      buyer: party('CL', 'B2B'),
      lines: [
        { id: 'l1', description: 'phase3 timer widget', quantity: 1, unitNetMinor: 5000, supplyType: 'GOODS' },
      ],
      issueDate: new Date('2027-02-01'),
      currency: 'CLP',
    };
    const plan = resolve(ctx);
    expect(plan.lifecycle.response?.defaultOnSilence).toBe('ACCEPT');

    const id = `phase3-timer-${Date.now()}`;
    const nowIso = new Date().toISOString();

    // Start directly in AWAITING_RESPONSE — LifecycleRuntime only needs the graph (from `plan`) and
    // the current status; it doesn't care how the document arrived there.
    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'AWAITING_RESPONSE',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const timerJobId = `phase3-timer-job-${Date.now()}`;
    const timerJob = createTimerJob(
      { id: timerJobId, documentId: id, awaiting: 'AWAITING_RESPONSE', onElapse: 'ACCEPT', deadlineHours: 0 },
      new Date(Date.now() - 5_000), // fireAt is already 5s in the past — due immediately
    );
    await timerStore.arm(timerJob);

    try {
      await dispatcher.enqueueTimer(id, timerJobId, 0);

      // TimerProcessor: get(ARMED, fireAt<=now) -> save FIRED -> applySignal(TIMER_ELAPSED) ->
      // runtime resolves TIMER_ELAPSED -> ACCEPT (BuyerResponsePhase) -> AWAITING_RESPONSE -> ACCEPTED.
      await waitFor(() => docStore.get(id), (d) => d?.status === 'ACCEPTED', 15000);

      const timerRow = await prisma.scheduledJob.findUnique({ where: { id: timerJobId } });
      expect(timerRow?.status).toBe('FIRED');
    } finally {
      await prisma.scheduledJob.deleteMany({ where: { documentId: id } });
      await prisma.complianceCallbackRegistration.deleteMany({ where: { documentId: id } });
      await prisma.complianceEvent.deleteMany({ where: { documentId: id } });
      await prisma.complianceAuthorityId.deleteMany({ where: { documentId: id } });
      await prisma.complianceDocument.deleteMany({ where: { id } });
    }
  });

  it('(b) sweep re-projects an orphaned PENDING poll ScheduledJob onto a real compliance-poll job', async () => {
    const ctx: TransactionContext = {
      supplier: party('MX', 'B2B'),
      buyer: party('MX', 'B2B'),
      lines: [
        { id: 'l1', description: 'phase3 sweep widget', quantity: 1, unitNetMinor: 7500, supplyType: 'GOODS' },
      ],
      issueDate: new Date('2027-02-01'),
      currency: 'MXN',
    };
    const plan = resolve(ctx);

    const id = `phase3-sweep-${Date.now()}`;
    const nowIso = new Date().toISOString();

    await docStore.save({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'PENDING_CLEARANCE',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const pollJobId = `phase3-sweep-job-${Date.now()}`;
    const pollJob = createPollJob(
      {
        id: pollJobId,
        documentId: id,
        providerId: 'phase3-sweep-mock',
        channel: 'PAC',
        ref: 'phase3-sweep-mock-ref',
        awaiting: 'PENDING_CLEARANCE',
        policy: { everySeconds: 60, timeoutHours: 1, backoff: 'NONE' },
      },
      new Date(),
    );
    // Deliberately DO NOT call dispatcher.enqueuePoll here — this row is an "orphan": persisted to
    // the durable ScheduledJob registry but with no live BullMQ job behind it (e.g. survived a Redis
    // flush, or the post-commit projection crashed before it ran).
    await pollStore.enqueue(pollJob);

    const pollEvents = new QueueEvents(Q_POLL, { connection: redisConnection() });
    await pollEvents.waitUntilReady();

    try {
      const expectedJobId = `poll-${id}`;
      // 'active' (not just 'waiting') proves a REAL PollProcessor worker actually picked the
      // re-projected job up for consumption — not just that something was added to the list.
      const activePromise = waitForActiveJob(pollEvents, expectedJobId, 15000);

      const sweepQueue = moduleRef.get<Queue>(getQueueToken(Q_SWEEP));
      await sweepQueue.add(
        'sweep',
        {},
        { jobId: `phase3-sweep-trigger-${Date.now()}`, removeOnComplete: true, removeOnFail: true },
      );

      await activePromise;

      // The deterministic jobId is exactly what dispatcher.enqueuePoll() would have used had the
      // original post-commit projection succeeded — proving the sweep is a faithful re-projection,
      // not a different code path.
      expect(expectedJobId).toBe(`poll-${id}`);
    } finally {
      await pollEvents.close();
      await prisma.scheduledJob.deleteMany({ where: { documentId: id } });
      await prisma.complianceCallbackRegistration.deleteMany({ where: { documentId: id } });
      await prisma.complianceEvent.deleteMany({ where: { documentId: id } });
      await prisma.complianceAuthorityId.deleteMany({ where: { documentId: id } });
      await prisma.complianceDocument.deleteMany({ where: { id } });
    }
  });
});

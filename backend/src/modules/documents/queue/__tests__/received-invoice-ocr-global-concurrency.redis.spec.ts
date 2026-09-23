/**
 * The received-invoice OCR queue's CLUSTER-WIDE concurrency cap — real Redis, real BullMQ, THREE
 * separate `Worker` instances (simulating three scaled worker replicas, the shape
 * `docker-compose.scale.yml` actually runs), each with its OWN per-worker `concurrency: 5` —
 * deliberately larger than the global cap this test sets — so the only thing that can possibly hold
 * the observed in-flight count down to the global cap is the global cap itself, never a per-worker
 * option that happens to be small enough to mask a broken one. See
 * `received-invoice-ocr.dispatcher.ts#applyGlobalConcurrency`'s own header for why a per-worker
 * `@Processor()` option alone (`received-invoice-ocr.processor.ts`) is NOT a cluster-wide cap: N
 * replicas each honoring their own small number can still let N times that many jobs run at once —
 * exactly the bug this cap exists to close. `received-invoice-ocr.dispatcher.spec.ts` already proves
 * the dispatcher CALLS `Queue.setGlobalConcurrency` with the right value, against a fake `Queue`; this
 * spec proves the mechanism itself is really enforced across independent `Worker` instances sharing
 * one Redis, which a fake `Queue` cannot.
 *
 * Self-gated exactly like this directory's other Redis specs — see
 * `document-action-queue.redis.spec.ts`'s own header for the full `DOCUMENTS_QUEUE_REDIS_TESTS=1`
 * reasoning (parallel Vitest workers sharing one real queue/DB otherwise race each other). Uses a
 * FRESH, uniquely-named queue — never `Q_RECEIVED_INVOICE_OCR` itself — so it needs none of the
 * company-scoped cleanup `queue-test-cleanup.ts` provides for the other specs here: nothing else in
 * this process, or in CI, ever addresses this queue name, which is what makes `queue.obliterate()`
 * safe in THIS one file (the other specs in this directory explain at length why it is not safe on
 * the shared `Q_DOCUMENT_ACTION` queue).
 *
 * Run standalone (index 7 on port 6399 — an isolated test Redis, never the compose stack's own
 * `redis:6379`):
 *   DOCUMENTS_QUEUE_REDIS_TESTS=1 REDIS_URL=redis://localhost:6399/7 npx vitest run \
 *     src/modules/documents/queue/__tests__/received-invoice-ocr-global-concurrency.redis.spec.ts
 */
import { randomUUID } from 'node:crypto';

import { vi } from 'vitest';

import { Queue, Worker } from 'bullmq';

import { redisConnection } from '../redis.config';

// Gated EXPLICITLY (DOCUMENTS_QUEUE_REDIS_TESTS=1), not merely on REDIS_URL being set — see this
// file's own header and document-action-queue.redis.spec.ts's own header for the full reasoning.
const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

const JOB_COUNT = 12;
const GLOBAL_CONCURRENCY = 2;
const PER_WORKER_CONCURRENCY = 5; // deliberately > GLOBAL_CONCURRENCY — see this file's own header
const WORKER_COUNT = 3;
const JOB_DURATION_MS = 300;

describeWithRedis('received-invoice OCR queue — real Redis global concurrency cap', () => {
  vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

  it('caps in-flight jobs at the GLOBAL value even though each of 3 workers allows 5 of its own', async () => {
    const queueName = `global-concurrency-proof-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: redisConnection() });
    let workers: Worker[] = [];

    try {
      await queue.waitUntilReady();
      // THE call under test — the exact one `ReceivedInvoiceOcrDispatcher.applyGlobalConcurrency`
      // makes on the real queue, reproduced here directly against a fresh queue so this spec can
      // prove BullMQ's OWN enforcement rather than re-asserting the dispatcher called it (already
      // covered by the mocked-Queue spec).
      await queue.setGlobalConcurrency(GLOBAL_CONCURRENCY);

      // Single-process counters are safe here: Node is single-threaded, and every increment/decrement
      // below runs synchronously between two `await`s, so there is no interleaving that could lose an
      // update even with three `Worker` instances pulling jobs concurrently in the same process.
      let inFlight = 0;
      let maxInFlight = 0;
      let completed = 0;

      const processor = async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, JOB_DURATION_MS));
        inFlight--;
        completed++;
      };

      // THREE independent Worker instances — never one Worker with concurrency 15 — because the
      // point is proving the cap holds ACROSS workers, the one thing a single-worker test could never
      // distinguish from an ordinary per-worker `concurrency` option working as documented.
      workers = Array.from(
        { length: WORKER_COUNT },
        () =>
          new Worker(queueName, processor, {
            connection: redisConnection(),
            concurrency: PER_WORKER_CONCURRENCY,
          }),
      );
      await Promise.all(workers.map((worker) => worker.waitUntilReady()));

      await Promise.all(Array.from({ length: JOB_COUNT }, (_, i) => queue.add('run', { i })));

      const deadline = Date.now() + 30000;
      while (completed < JOB_COUNT) {
        if (Date.now() > deadline) {
          throw new Error(
            `only ${completed}/${JOB_COUNT} jobs completed within the deadline (maxInFlight so far: ${maxInFlight})`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // 3 workers x concurrency 5 = 15 available slots, comfortably above JOB_COUNT (12) and far
      // above GLOBAL_CONCURRENCY (2) — if the global cap were not enforced, maxInFlight would land
      // somewhere well above 2 (up to 12). Landing at exactly 2 is the proof the cap is real.
      expect(maxInFlight).toBe(GLOBAL_CONCURRENCY);
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
      // Safe ONLY because this queue name is fresh and unique to this one test run — see this file's
      // own header for why `queue-test-cleanup.ts`'s targeted approach is unnecessary here.
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

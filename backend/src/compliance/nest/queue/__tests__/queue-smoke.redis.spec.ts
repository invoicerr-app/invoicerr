import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';

import { ComplianceWorkerModule } from '../compliance-worker.module';
import { PingJobData, Q_PING } from '../queue.constants';
import { QueueModule } from '../queue.module';
import { redisConnection } from '../redis.config';

/**
 * Real Redis integration smoke test (QUEUE_IMPL_PLAN.md §4.9 / §11).
 *
 * Self-gated on `REDIS_URL` (same pattern as providers/transmission/live-gate.ts): when the
 * env var is absent this suite is skipped entirely, so the ~1475 offline jest tests never
 * need Redis. When `REDIS_URL` is set (CI's `queue-integration` job, or a local throwaway
 * Redis container), it boots a real Nest module graph containing both the enqueue-capable
 * QueueModule and the consuming ComplianceWorkerModule, enqueues a job on the disposable
 * `compliance-ping` queue, and asserts that a REAL BullMQ worker consumes it end-to-end
 * (waits for the `completed` event — a mock does not count, per the KSeF false-green lesson).
 */
const hasRedis = !!process.env.REDIS_URL;
const describeWithRedis = hasRedis ? describe : describe.skip;

describeWithRedis('compliance queue smoke (real Redis, enqueue -> consume)', () => {
  jest.setTimeout(30000);

  let moduleRef: TestingModule;
  let queue: Queue<PingJobData>;
  let events: QueueEvents;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [QueueModule, ComplianceWorkerModule],
    }).compile();

    await moduleRef.init();

    queue = moduleRef.get<Queue<PingJobData>>(getQueueToken(Q_PING));

    events = new QueueEvents(Q_PING, { connection: redisConnection() });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await events?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await moduleRef?.close();
  });

  it('enqueues a ping job and a real BullMQ worker consumes it (completed)', async () => {
    const job = await queue.add(
      'ping',
      { sentAt: new Date().toISOString() },
      { jobId: `smoke-${Date.now()}`, removeOnComplete: true, removeOnFail: true },
    );

    const result = await job.waitUntilFinished(events, 20000);

    expect(result).toEqual(expect.objectContaining({ pong: true }));
  });
});

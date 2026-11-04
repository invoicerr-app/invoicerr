/**
 * End-to-end proof of the queue against real Redis and a real HTTP receiver: `dispatch` returns while
 * a slow receiver is still silent, a failing receiver is retried then given up on with an ERROR log,
 * and a receiver that fails twice then succeeds recovers on the same job. Self-gated on
 * `DOCUMENTS_QUEUE_REDIS_TESTS=1`, like the sibling queue specs.
 */
import { vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import prisma from '@/prisma/prisma.service';

import { WebhookEvent, WebhookType } from '../../../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from '../../webhook-dispatcher.service';
import { WebhooksQueueWorkerModule } from '../webhooks-queue-worker.module';
import { Q_WEBHOOK_DELIVERY } from '../webhook-queue.constants';

const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

function startStubReceiver(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}/hook` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Every state a job could be sitting in, removed by this spec's own companyId; never `obliterate`,
 *  which could reach another test's or a live backend's jobs. */
const ALL_JOB_STATES = [
  'completed',
  'failed',
  'active',
  'delayed',
  'waiting',
  'waiting-children',
  'prioritized',
  'paused',
] as const;

async function removeQueueJobsForCompany(queue: Queue, companyId: string): Promise<void> {
  const jobs = await queue.getJobs([...ALL_JOB_STATES]);
  const mine = jobs.filter(
    (job) => (job.data as { companyId?: string } | undefined)?.companyId === companyId,
  );
  await Promise.all(mine.map((job) => job.remove().catch(() => undefined)));
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeWithRedis('outbound-webhook queue — real Redis, a real BullMQ worker, a real HTTP receiver', () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  let moduleRef: TestingModule;
  let dispatcher: WebhookDispatcherService;
  let queue: Queue;
  let companyId: string;

  beforeAll(async () => {
    // Test-only escape hatch: the receiver is on 127.0.0.1, which the guard rejects by default.
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
    // Small, fast numbers so "retried, then given up on" is observable in a test, never the real
    // ~63-minute production default (`webhook-queue.constants.ts#readWebhookQueueAttempts`'s own
    // header) — the identical "override for test speed" move
    // `document-action-queue.redis.spec.ts` makes for `DOCUMENT_ACTION_QUEUE_ATTEMPTS`.
    process.env.WEBHOOK_QUEUE_ATTEMPTS = '3';
    process.env.WEBHOOK_QUEUE_BACKOFF_MS = '200';

    moduleRef = await Test.createTestingModule({ imports: [WebhooksQueueWorkerModule] }).compile();
    await moduleRef.init();

    dispatcher = moduleRef.get(WebhookDispatcherService);
    queue = moduleRef.get<Queue>(getQueueToken(Q_WEBHOOK_DELIVERY));

    const company = await prisma.company.create({
      data: {
        name: 'Webhook Queue Integration Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Queue Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: 'webhook-queue-integration@example.com',
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    if (queue && companyId) await removeQueueJobsForCompany(queue, companyId);
    if (companyId) {
      await prisma.log.deleteMany({ where: { companyId } }).catch(() => undefined);
      await prisma.webhook.deleteMany({ where: { companyId } }).catch(() => undefined);
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await moduleRef?.close();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
    delete process.env.WEBHOOK_QUEUE_ATTEMPTS;
    delete process.env.WEBHOOK_QUEUE_BACKOFF_MS;
  });

  it('dispatch() resolves while the receiver has not answered yet — the triggering caller never waits on delivery', async () => {
    let releaseReceiver: (() => void) | undefined;
    const receiverGate = new Promise<void>((resolve) => {
      releaseReceiver = resolve;
    });
    let received = false;

    const { server, url } = await startStubReceiver(async (_req, res) => {
      await receiverGate; // held open until this test explicitly releases it, below
      received = true;
      res.writeHead(200).end();
    });

    const webhook = await prisma.webhook.create({
      data: { url, type: WebhookType.GENERIC, events: [WebhookEvent.CLIENT_CREATED], companyId },
    });

    try {
      const dispatchStarted = Date.now();
      await dispatcher.dispatch(WebhookEvent.CLIENT_CREATED, { companyId });
      const dispatchElapsedMs = Date.now() - dispatchStarted;

      // The enqueue itself is a fast, local Redis write — nowhere near how long the receiver is held
      // open for (releaseReceiver has not even been called yet at this point).
      expect(dispatchElapsedMs).toBeLessThan(2000);
      expect(received).toBe(false); // the receiver genuinely has not been reached yet

      releaseReceiver?.();
      await waitFor(async () => received);
      expect(received).toBe(true); // and delivery genuinely does happen, once the receiver is free
    } finally {
      await closeServer(server);
      await prisma.webhook.delete({ where: { id: webhook.id } }).catch(() => undefined);
    }
  });

  it('a receiver that always fails is retried, then given up on — and the give-up is a visible ERROR log', async () => {
    let requestCount = 0;
    const { server, url } = await startStubReceiver((_req, res) => {
      requestCount += 1;
      res.writeHead(500).end();
    });

    const webhook = await prisma.webhook.create({
      data: { url, type: WebhookType.GENERIC, events: [WebhookEvent.CLIENT_UPDATED], companyId },
    });

    try {
      await dispatcher.dispatch(WebhookEvent.CLIENT_UPDATED, { companyId });

      // WEBHOOK_QUEUE_ATTEMPTS=3 and every attempt fails: exactly 3 requests, never more, never fewer.
      await waitFor(async () => requestCount >= 3, 20000);
      // Let the terminal `failed` event and its `onFailed` log settle.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(requestCount).toBe(3);

      // Scoped by event: this describe block shares one company, and Log rows are never cleaned up, so
      // a bare companyId+level filter would match another test's terminal failure.
      const failureLog = await prisma.log.findFirst({
        where: {
          companyId,
          category: 'webhook-dispatcher',
          level: 'ERROR',
          details: { path: ['event'], equals: WebhookEvent.CLIENT_UPDATED },
        },
        orderBy: { timestamp: 'desc' },
      });
      expect(failureLog).not.toBeNull();
      expect(failureLog!.message).toContain('every retry attempt was exhausted');
    } finally {
      await closeServer(server);
      await prisma.webhook.delete({ where: { id: webhook.id } }).catch(() => undefined);
    }
  });

  it('a receiver that fails twice then succeeds recovers via the SAME retried job', async () => {
    let requestCount = 0;
    const { server, url } = await startStubReceiver((_req, res) => {
      requestCount += 1;
      if (requestCount < 3) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200).end();
    });

    const webhook = await prisma.webhook.create({
      data: { url, type: WebhookType.GENERIC, events: [WebhookEvent.CLIENT_DELETED], companyId },
    });

    try {
      await dispatcher.dispatch(WebhookEvent.CLIENT_DELETED, { companyId });

      await waitFor(async () => requestCount >= 3, 20000);
      // Success only: the recovery did not also exhaust its attempts. Scoped by event because this
      // company's Log rows accumulate across tests.
      await waitFor(async () => {
        const success = await prisma.log.findFirst({
          where: {
            companyId,
            category: 'webhook-dispatcher',
            level: 'INFO',
            message: 'Webhook dispatched',
            details: { path: ['event'], equals: WebhookEvent.CLIENT_DELETED },
          },
        });
        return !!success;
      });

      const terminalFailure = await prisma.log.findFirst({
        where: {
          companyId,
          category: 'webhook-dispatcher',
          level: 'ERROR',
          details: { path: ['event'], equals: WebhookEvent.CLIENT_DELETED },
        },
      });
      expect(terminalFailure).toBeNull();
    } finally {
      await closeServer(server);
      await prisma.webhook.delete({ where: { id: webhook.id } }).catch(() => undefined);
    }
  });

  it('two subscribers on the same event: a retry against the failing one never redelivers to its healthy sibling', async () => {
    // One job per subscriber: a retry against the failing one must never redeliver to the healthy one.
    let healthyRequestCount = 0;
    let failingRequestCount = 0;
    const healthy = await startStubReceiver((_req, res) => {
      healthyRequestCount += 1;
      res.writeHead(200).end();
    });
    const failing = await startStubReceiver((_req, res) => {
      failingRequestCount += 1;
      res.writeHead(500).end();
    });

    const [healthyWebhook, failingWebhook] = await Promise.all([
      prisma.webhook.create({
        data: {
          url: healthy.url,
          type: WebhookType.GENERIC,
          events: [WebhookEvent.WEBHOOK_CREATED],
          companyId,
        },
      }),
      prisma.webhook.create({
        data: {
          url: failing.url,
          type: WebhookType.GENERIC,
          events: [WebhookEvent.WEBHOOK_CREATED],
          companyId,
        },
      }),
    ]);

    try {
      await dispatcher.dispatch(WebhookEvent.WEBHOOK_CREATED, { companyId });

      // Same 3 attempts as the test above.
      await waitFor(async () => failingRequestCount >= 3, 20000);
      await new Promise((resolve) => setTimeout(resolve, 500)); // let onFailed's own log settle

      expect(failingRequestCount).toBe(3);
      // The healthy sibling was reached exactly once: no retry-driven duplicate.
      expect(healthyRequestCount).toBe(1);
    } finally {
      await closeServer(healthy.server);
      await closeServer(failing.server);
      await prisma.webhook.deleteMany({ where: { id: { in: [healthyWebhook.id, failingWebhook.id] } } });
    }
  });
});

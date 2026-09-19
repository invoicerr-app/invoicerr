/**
 * `WebhookDeliveryProcessor` — proves offline what
 * `__tests__/webhook-delivery-queue.redis.spec.ts` proves again end-to-end against a real queue and a
 * real (deliberately failing) receiver: a job stays quiet while retries remain, and once every attempt
 * is spent the failure is logged loudly — the same `category: 'webhook-dispatcher'`, ERROR-severity
 * signal a pre-queue, single-shot dispatch failure already produced (see
 * `webhook-dispatcher.service.ts`'s own header for that contract).
 */
import { vi, type Mock } from 'vitest';

import type { Job } from 'bullmq';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WEBHOOK_DELIVERY_JOB_NAME, WebhookDeliveryJobData } from './webhook-queue.constants';
import { logger } from '@/logger/logger.service';

vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockedLogger = logger as unknown as { error: Mock };

const JOB_DATA: WebhookDeliveryJobData = {
  companyId: 'company-1',
  webhookId: 'wh-1',
  event: WebhookEvent.CLIENT_CREATED,
  payload: { companyId: 'company-1' },
};

function fakeJob(overrides: { attemptsMade?: number; attempts?: number; name?: string } = {}) {
  return {
    id: 'job-1',
    name: overrides.name ?? WEBHOOK_DELIVERY_JOB_NAME,
    data: JOB_DATA,
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<WebhookDeliveryJobData>;
}

describe('WebhookDeliveryProcessor', () => {
  let delivery: { deliver: Mock };
  let processor: WebhookDeliveryProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    delivery = { deliver: vi.fn().mockResolvedValue(undefined) };
    processor = new WebhookDeliveryProcessor(delivery as unknown as WebhookDeliveryService);
  });

  describe('process()', () => {
    it('replays (companyId, webhookId, event, payload) through WebhookDeliveryService.deliver', async () => {
      await processor.process(fakeJob());
      expect(delivery.deliver).toHaveBeenCalledWith(
        JOB_DATA.companyId,
        JOB_DATA.webhookId,
        JOB_DATA.event,
        JOB_DATA.payload,
      );
    });

    it('lets a delivery failure propagate — this is what tells BullMQ to schedule a retry', async () => {
      delivery.deliver.mockRejectedValue(new Error('endpoint unreachable'));
      await expect(processor.process(fakeJob())).rejects.toThrow('endpoint unreachable');
    });

    it('refuses an unknown job name rather than silently misinterpreting its data', async () => {
      await expect(processor.process(fakeJob({ name: 'not-a-real-job' }))).rejects.toThrow(/Unknown job/);
      expect(delivery.deliver).not.toHaveBeenCalled();
    });
  });

  describe('onFailed()', () => {
    it('stays quiet while more retries remain (attemptsMade < attempts) — BullMQ is already retrying', () => {
      const job = fakeJob({ attemptsMade: 1, attempts: 7 });
      processor.onFailed(job, new Error('transient timeout'));
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it('logs an ERROR, visible the same way a pre-queue dispatch failure always was, once every attempt is spent', () => {
      const job = fakeJob({ attemptsMade: 7, attempts: 7 });
      const error = new Error('endpoint refused every attempt');

      processor.onFailed(job, error);

      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('every retry attempt was exhausted'),
        expect.objectContaining({
          category: 'webhook-dispatcher',
          companyId: JOB_DATA.companyId,
          details: expect.objectContaining({
            event: JOB_DATA.event,
            attempts: 7,
            message: error.message,
          }),
        }),
      );
    });

    it('never throws, even with no job — an event listener that throws kills the whole worker process', () => {
      expect(() => processor.onFailed(undefined, new Error('x'))).not.toThrow();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it('defaults to 1 attempt when a job somehow carries no opts.attempts', () => {
      const job = {
        id: 'job-2',
        data: JOB_DATA,
        attemptsMade: 1,
        opts: {},
      } as unknown as Job<WebhookDeliveryJobData>;

      processor.onFailed(job, new Error('boom'));
      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    });
  });
});

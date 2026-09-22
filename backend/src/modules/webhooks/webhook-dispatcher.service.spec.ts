/**
 * `WebhookDispatcherService.dispatch` — the tenant filter, and the enqueue contract that replaced an
 * inline HTTP send. The tenant-scoping proof here is narrower than it used to be: `dispatch()` no
 * longer SENDS anything itself (that moved to `WebhookDeliveryService` — see
 * `webhook-delivery.service.spec.ts` for the "reaches only this company's own webhook, never logs a
 * secret" proofs). What THIS file proves is what `dispatch()` still owns: refusing a payload with no
 * resolvable companyId before anything is ever queued, resolving which subscribers exist, and handing
 * the queue exactly one job PER SUBSCRIBER (see `webhook-queue.constants.ts#WebhookDeliveryJobData`'s
 * own header for why per-subscriber, not per-event).
 */

import { vi, type Mock } from 'vitest';

import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WEBHOOK_DELIVERY_JOB_NAME } from './queue/webhook-queue.constants';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { webhook: { findMany: vi.fn() } },
}));

vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockedPrisma = prisma as unknown as { webhook: { findMany: Mock } };
const mockedLogger = logger as unknown as { info: Mock; error: Mock };

const COMPANY_ID = 'company-1';

describe('WebhookDispatcherService.dispatch', () => {
  let service: WebhookDispatcherService;
  let queue: { add: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    service = new WebhookDispatcherService(queue as never);
  });

  describe('a payload with no resolvable companyId', () => {
    it("refuses to dispatch rather than fan out to every tenant (CLIENT_SEARCHED's own shape)", async () => {
      await expect(
        service.dispatch(WebhookEvent.CLIENT_SEARCHED, { query: 'acme', results: 3 }),
      ).rejects.toThrow(/companyId/);

      expect(mockedPrisma.webhook.findMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('refuses even when the payload carries an unrelated object under a different key', async () => {
      await expect(
        service.dispatch(WebhookEvent.CLIENT_CREATED, { client: { id: 'client-1' } }),
      ).rejects.toThrow(/companyId/);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('logs the refusal without ever touching Prisma or the queue', async () => {
      await expect(service.dispatch(WebhookEvent.CLIENT_DELETED, {})).rejects.toThrow();
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Refused to dispatch'),
        expect.objectContaining({ details: { event: WebhookEvent.CLIENT_DELETED } }),
      );
      expect(mockedPrisma.webhook.findMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('a payload that does resolve a companyId', () => {
    it('scopes the subscriber lookup by companyId and event', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([]);
      await service.dispatch(WebhookEvent.WEBHOOK_CREATED, { companyId: COMPANY_ID });

      expect(mockedPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, events: { has: WebhookEvent.WEBHOOK_CREATED } },
        select: { id: true },
      });
    });

    it('also accepts the company.id shape existing emitters already use (company.service.ts)', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }]);
      const payload = { company: { id: COMPANY_ID } };
      await service.dispatch(WebhookEvent.COMPANY_UPDATED, payload);

      expect(mockedPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, events: { has: WebhookEvent.COMPANY_UPDATED } },
        select: { id: true },
      });
      expect(queue.add).toHaveBeenCalledWith(
        WEBHOOK_DELIVERY_JOB_NAME,
        { companyId: COMPANY_ID, webhookId: 'wh-1', event: WebhookEvent.COMPANY_UPDATED, payload },
        expect.any(Object),
      );
    });

    it('enqueues one job PER SUBSCRIBER, never one job that would fan out internally', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }, { id: 'wh-2' }]);
      await service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID });

      expect(queue.add).toHaveBeenCalledTimes(2);
      const webhookIds = queue.add.mock.calls.map(
        ([, data]: [string, { webhookId: string }]) => data.webhookId,
      );
      expect(webhookIds.sort()).toEqual(['wh-1', 'wh-2']);
    });

    it('enqueues nothing when no webhook is subscribed — a clean no-op', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([]);
      await expect(
        service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID }),
      ).resolves.toBeUndefined();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('resolves as soon as the job(s) are queued — it never waits on a delivery', async () => {
      // The whole point of this move: neither the subscriber lookup (a fast, local Prisma read) nor
      // `queue.add` (a fast, local Redis write) can block on a customer's own HTTP response — proven
      // structurally here, and end-to-end (a slow/unreachable receiver) in
      // `queue/__tests__/webhook-delivery-queue.redis.spec.ts`.
      mockedPrisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }]);
      await expect(
        service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID }),
      ).resolves.toBeUndefined();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('the queue itself failing', () => {
    it('logs and rethrows when the enqueue fails (e.g. Redis unreachable) — the identical "logs, then rethrows" contract every caller already handles', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }]);
      queue.add.mockRejectedValue(new Error('redis unreachable'));

      await expect(service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID })).rejects.toThrow(
        'redis unreachable',
      );

      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Failed to enqueue a webhook delivery',
        expect.objectContaining({ companyId: COMPANY_ID }),
      );
    });
  });
});

/**
 * `WebhookDispatcherService.dispatch` — the tenant filter itself.
 *
 * Before this fix, a payload with no resolvable companyId (exactly what the four `CLIENT_*` emitters
 * in `clients.service.ts` send — `{ client }` or `{ query, results }`, never `companyId`/`company`)
 * fell through to `prisma.webhook.findMany({ where: { events: { has: event } } })`: no tenant clause
 * at all, so it read (and delivered to) every company's webhooks on the instance. This file proves the
 * opposite now holds — a dispatch with no companyId is refused outright, never silently widened — and
 * that a successful dispatch never logs a webhook's `secret`.
 */

import { vi, type Mock } from 'vitest';

import { WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhooksService } from './webhooks.service';
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

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh-1',
    url: 'https://8.8.8.8/hook',
    secret: 'super-secret-hmac-key',
    type: WebhookType.GENERIC,
    events: [WebhookEvent.CLIENT_CREATED],
    companyId: COMPANY_ID,
    ...overrides,
  };
}

describe('WebhookDispatcherService.dispatch', () => {
  let service: WebhookDispatcherService;
  let webhooksService: { send: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    webhooksService = { send: vi.fn().mockResolvedValue([true]) };
    service = new WebhookDispatcherService(webhooksService as unknown as WebhooksService);
  });

  describe('a payload with no resolvable companyId', () => {
    it("refuses to dispatch rather than fan out to every tenant (CLIENT_SEARCHED's own shape)", async () => {
      await expect(
        service.dispatch(WebhookEvent.CLIENT_SEARCHED, { query: 'acme', results: 3 }),
      ).rejects.toThrow(/companyId/);

      expect(mockedPrisma.webhook.findMany).not.toHaveBeenCalled();
      expect(webhooksService.send).not.toHaveBeenCalled();
    });

    it('refuses even when the payload carries an unrelated object under a different key', async () => {
      await expect(
        service.dispatch(WebhookEvent.CLIENT_CREATED, { client: { id: 'client-1' } }),
      ).rejects.toThrow(/companyId/);
      expect(mockedPrisma.webhook.findMany).not.toHaveBeenCalled();
    });

    it('logs the refusal without ever calling Prisma (nothing to summarize into the log either)', async () => {
      await expect(service.dispatch(WebhookEvent.CLIENT_DELETED, {})).rejects.toThrow();
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Refused to dispatch'),
        expect.objectContaining({ details: { event: WebhookEvent.CLIENT_DELETED } }),
      );
    });
  });

  describe('a payload that does resolve a companyId', () => {
    it('scopes the query by companyId when it is given directly', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([]);
      await service.dispatch(WebhookEvent.WEBHOOK_CREATED, { companyId: COMPANY_ID });

      expect(mockedPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, events: { has: WebhookEvent.WEBHOOK_CREATED } },
      });
    });

    it('also accepts the company.id shape existing emitters already use (company.service.ts)', async () => {
      mockedPrisma.webhook.findMany.mockResolvedValue([]);
      await service.dispatch(WebhookEvent.COMPANY_UPDATED, { company: { id: COMPANY_ID } });

      expect(mockedPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, events: { has: WebhookEvent.COMPANY_UPDATED } },
      });
    });

    it('never logs the webhook secret on a successful dispatch', async () => {
      const webhook = makeWebhook();
      mockedPrisma.webhook.findMany.mockResolvedValue([webhook]);

      await service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID });

      expect(mockedLogger.info).toHaveBeenCalledTimes(1);
      const loggedPayload = JSON.stringify(mockedLogger.info.mock.calls[0]);
      expect(loggedPayload).not.toContain(webhook.secret);
      // The non-secret fields ARE still there — this isn't just an empty log.
      expect(loggedPayload).toContain(webhook.id);
      expect(loggedPayload).toContain(webhook.url);
    });

    it('never logs the webhook secret when the underlying send fails either', async () => {
      const webhook = makeWebhook();
      mockedPrisma.webhook.findMany.mockResolvedValue([webhook]);
      webhooksService.send.mockRejectedValue(new Error('boom'));

      await expect(service.dispatch(WebhookEvent.CLIENT_CREATED, { companyId: COMPANY_ID })).rejects.toThrow(
        'boom',
      );

      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
      const loggedPayload = JSON.stringify(mockedLogger.error.mock.calls[0]);
      expect(loggedPayload).not.toContain(webhook.secret);
    });
  });
});

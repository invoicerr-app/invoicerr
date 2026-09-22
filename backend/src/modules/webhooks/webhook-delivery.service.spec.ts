/**
 * `WebhookDeliveryService.deliver` — the per-subscriber fresh-lookup, secret-redaction, and
 * "an HTTP-level failure is a failure worth retrying" proofs. `dispatch()` itself only enqueues
 * (`webhook-dispatcher.service.spec.ts`); this file proves what actually reaches `prisma.webhook` and
 * `WebhooksService.send` for ONE (event, webhookId) pair.
 */

import { vi, type Mock } from 'vitest';

import { WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhooksService } from './webhooks.service';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { webhook: { findUnique: vi.fn() } },
}));

vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockedPrisma = prisma as unknown as { webhook: { findUnique: Mock } };
const mockedLogger = logger as unknown as { info: Mock; warn: Mock };

const COMPANY_ID = 'company-1';
const WEBHOOK_ID = 'wh-1';

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    url: 'https://8.8.8.8/hook',
    secret: 'super-secret-hmac-key',
    type: WebhookType.GENERIC,
    events: [WebhookEvent.CLIENT_CREATED],
    companyId: COMPANY_ID,
    ...overrides,
  };
}

describe('WebhookDeliveryService.deliver', () => {
  let service: WebhookDeliveryService;
  let webhooksService: { send: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    webhooksService = { send: vi.fn().mockResolvedValue([true]) };
    service = new WebhookDeliveryService(webhooksService as unknown as WebhooksService);
  });

  it('re-fetches the webhook fresh by id on every call', async () => {
    mockedPrisma.webhook.findUnique.mockResolvedValue(makeWebhook());
    await service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {});

    expect(mockedPrisma.webhook.findUnique).toHaveBeenCalledWith({ where: { id: WEBHOOK_ID } });
  });

  it('is a clean no-op, never a failure, when the webhook no longer exists', async () => {
    mockedPrisma.webhook.findUnique.mockResolvedValue(null);

    await expect(
      service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {}),
    ).resolves.toBeUndefined();
    expect(webhooksService.send).not.toHaveBeenCalled();
  });

  it('is a clean no-op when the webhook now belongs to a DIFFERENT company (tenant-scoping)', async () => {
    mockedPrisma.webhook.findUnique.mockResolvedValue(makeWebhook({ companyId: 'another-company' }));

    await expect(
      service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {}),
    ).resolves.toBeUndefined();
    expect(webhooksService.send).not.toHaveBeenCalled();
  });

  it('never logs the webhook secret on a successful delivery', async () => {
    const webhook = makeWebhook();
    mockedPrisma.webhook.findUnique.mockResolvedValue(webhook);

    await service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {});

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(mockedLogger.info.mock.calls[0]);
    expect(loggedPayload).not.toContain(webhook.secret);
    // The non-secret fields ARE still there — this isn't just an empty log.
    expect(loggedPayload).toContain(webhook.id);
    expect(loggedPayload).toContain(webhook.url);
  });

  it('treats an HTTP-level failure (send() returning false) as a failure worth retrying, never a silent success', async () => {
    const webhook = makeWebhook();
    mockedPrisma.webhook.findUnique.mockResolvedValue(webhook);
    webhooksService.send.mockResolvedValue([false]); // e.g. the endpoint answered 500 — no throw

    await expect(service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {})).rejects.toThrow();
    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('never logs the webhook secret when the underlying send throws either, and rethrows', async () => {
    const webhook = makeWebhook();
    mockedPrisma.webhook.findUnique.mockResolvedValue(webhook);
    webhooksService.send.mockRejectedValue(new Error('boom'));

    await expect(service.deliver(COMPANY_ID, WEBHOOK_ID, WebhookEvent.CLIENT_CREATED, {})).rejects.toThrow(
      'boom',
    );

    // WARN, not ERROR: this method cannot tell "BullMQ will retry" from "this was the last attempt" —
    // see this file's own header and `queue/webhook-delivery.processor.ts`'s own `onFailed`, which is
    // the one place that escalates to ERROR once every attempt is genuinely spent.
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(mockedLogger.warn.mock.calls[0]);
    expect(loggedPayload).not.toContain(webhook.secret);
  });
});

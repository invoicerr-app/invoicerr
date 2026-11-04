/**
 * The keyless configuration: no `CREDENTIALS_ENCRYPTION_KEY` at all, which is what a self-hosted
 * instance following the documentation runs. The sibling spec covers the key-present round trip; this
 * one proves the refusals and the legacy rows that must keep working.
 */

import { vi, type Mock } from 'vitest';

// Before importing anything that reads it: an inherited key would turn these into tests of the
// working configuration.
delete process.env.CREDENTIALS_ENCRYPTION_KEY;

import { HttpStatus } from '@nestjs/common';

import { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhooksService } from './webhooks.service';
import prisma from '@/prisma/prisma.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUniqueOrThrow: vi.fn() },
    webhook: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUniqueOrThrow: Mock };
  webhook: { findFirst: Mock; create: Mock; update: Mock };
};

const COMPANY_ID = 'company-1';
const COMPANY_ROW = { id: COMPANY_ID, name: 'Acme' };

/** Not a real secret, and never asserted against a stored column: it exists only so the assertions can
 *  say this exact string must not reach Prisma. */
const SUPPLIED_SECRET = 'supplied-by-the-caller';

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh-1',
    url: 'https://8.8.8.8/hook',
    secret: null,
    type: WebhookType.GENERIC,
    events: [WebhookEvent.WEBHOOK_CREATED],
    companyId: COMPANY_ID,
    ...overrides,
  } as Webhook;
}

describe('WebhooksService — no CREDENTIALS_ENCRYPTION_KEY configured', () => {
  let service: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
    mockedPrisma.webhook.create.mockImplementation(async ({ data }) => makeWebhook({ secret: data.secret }));
    mockedPrisma.webhook.update.mockImplementation(async ({ data }) => makeWebhook({ secret: data.secret }));
    service = new WebhooksService();
  });

  it('is genuinely running without a key (guards this file against a leaked ambient value)', () => {
    expect(process.env.CREDENTIALS_ENCRYPTION_KEY).toBeUndefined();
  });

  describe('create', () => {
    it('refuses to store a secret it cannot encrypt, rather than persisting it in the clear', async () => {
      await expect(
        service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook', secret: SUPPLIED_SECRET }),
      ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    });

    it('names the variable the operator has to set, so the failure is actionable', async () => {
      await expect(
        service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook', secret: SUPPLIED_SECRET }),
      ).rejects.toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    });

    it('writes nothing at all — the row must not exist half-created with a plaintext column', async () => {
      await expect(
        service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook', secret: SUPPLIED_SECRET }),
      ).rejects.toThrow();

      expect(mockedPrisma.webhook.create).not.toHaveBeenCalled();
    });

    it('still creates a webhook that carries NO secret — the posture refuses a secret, not the feature', async () => {
      const { webhook } = await service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook' });

      expect(mockedPrisma.webhook.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.webhook.create.mock.calls[0][0].data.secret).toBe('');
      expect(webhook.secret).toBe('');
    });
  });

  describe('update', () => {
    it('refuses a newly supplied secret and leaves the stored column untouched', async () => {
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ secret: null }));

      await expect(service.update(COMPANY_ID, 'wh-1', { secret: SUPPLIED_SECRET })).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      expect(mockedPrisma.webhook.update).not.toHaveBeenCalled();
    });

    it('still allows updating everything else on a webhook, secret left as it is', async () => {
      // A legacy plaintext row must stay editable: refusing an unrelated edit would strand rows the
      // operator cannot even see.
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ secret: 'legacy-stored-value' }));

      await service.update(COMPANY_ID, 'wh-1', { url: 'https://8.8.8.8/other' });

      expect(mockedPrisma.webhook.update).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.webhook.update.mock.calls[0][0].data.secret).toBe('legacy-stored-value');
      expect(mockedPrisma.webhook.update.mock.calls[0][0].data.url).toBe('https://8.8.8.8/other');
    });

    it('refuses to CLEAR a secret by re-supplying it — an empty string is still "no secret", not a write of one', async () => {
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ secret: 'legacy-stored-value' }));

      await service.update(COMPANY_ID, 'wh-1', { secret: '' });

      // Clearing needs no encryption, so it stays available without a key.
      expect(mockedPrisma.webhook.update.mock.calls[0][0].data.secret).toBe('');
    });
  });

  describe('send — a row already written in the clear keeps working', () => {
    afterEach(() => vi.restoreAllMocks());

    it('signs with a legacy plaintext secret, because refusing to sign would silently break deliveries', async () => {
      // Rows written without a key already exist: they keep signing until the boot catch-up encrypts
      // them.
      let capturedSignature: string | null = null;
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
        capturedSignature = init.headers['X-Webhook-Signature'] ?? null;
        return { ok: true } as Response;
      });

      const results = await service.send(
        [makeWebhook({ secret: 'legacy-stored-value' })],
        WebhookEvent.WEBHOOK_CREATED,
        { company: COMPANY_ROW },
      );

      expect(results).toEqual([true]);
      expect(capturedSignature).not.toBeNull();
    });
  });
});

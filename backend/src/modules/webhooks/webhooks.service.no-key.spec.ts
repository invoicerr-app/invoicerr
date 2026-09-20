/**
 * The DEFECTIVE configuration, and the only one this file exercises: no `CREDENTIALS_ENCRYPTION_KEY`
 * at all.
 *
 * `webhooks.service.secret-encryption.spec.ts` next door proves the encrypted-at-rest round-trip, but
 * it sets a key at the top of the file — so it can only ever assert the configuration where the key
 * IS present. That is not the configuration a self-hosted instance actually runs: `.env.example` ships
 * the variable commented out and `docker-compose.yml` passes it with an empty default, so an instance
 * built by following the documentation has no key, and every assertion below describes exactly that
 * instance.
 *
 * Vitest's `pool: 'forks'` (vitest.config.ts) gives this file its own process, so deleting the
 * variable here cannot leak into the sibling spec that sets it — and nothing in this project's vitest
 * config loads `.env.test`, which does define a key.
 */

import { vi, type Mock } from 'vitest';

// Before importing anything that reads it. An inherited key from the ambient shell would turn every
// assertion below into a test of the WORKING configuration — i.e. green for the wrong reason.
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

/** A value that is not a real secret and is never asserted against a stored column — it exists only
 *  so the assertions below can say "this exact string must not have reached Prisma". */
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
      // A legacy plaintext row — exactly what an instance that ran without a key has in its table. An
      // unrelated edit (the URL) must keep working and must pass the stored value straight through:
      // refusing here would make already-stored rows uneditable, which is the regression the "refuse
      // to boot" posture would have caused for the whole instance.
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
      // This is the row an instance that ran without a key already has. The fix above stops NEW ones
      // from being written; it deliberately does not strand the ones already there, which keep signing
      // exactly as before until the boot catch-up (`webhook-secret-migration.ts`) encrypts them the
      // first time the instance boots with a key.
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

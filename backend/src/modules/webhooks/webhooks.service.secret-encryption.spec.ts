/**
 * `Webhook.secret` used to be persisted exactly as the caller typed it, the one integration
 * credential in this codebase that bypassed `utils/secret-crypto.ts` (every other one — channel
 * configs, signing certificates — already goes through it). This file proves: (1) `create`/`update`
 * encrypt the value before it reaches Prisma, (2) `create`'s own response still hands the CALLER the
 * plaintext exactly once (the settings screen's "shown once" reveal — `webhooks.settings.tsx`), never
 * the ciphertext that actually landed in the column, (3) an update that does not touch the secret
 * never re-encrypts (and so never corrupts) whatever was already stored, and (4) `send()` decrypts
 * before computing the HMAC signature, falling back sanely when a blob can't be decrypted or a stored
 * value is still legacy plaintext (pre-migration, or written while no key was configured).
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is set here, in-process, to a fixed test value — the same pattern
 * `channels.service.spec.ts` already established for exercising the real AES-256-GCM round-trip.
 */
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { createHmac } from 'node:crypto';

import { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhooksService } from './webhooks.service';
import { isEncryptedWebhookSecret } from './webhook-secret-format';
import { decryptJson, encryptJson } from '@/utils/secret-crypto';
import prisma from '@/prisma/prisma.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUniqueOrThrow: jest.fn() },
    webhook: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUniqueOrThrow: jest.Mock };
  webhook: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};

const COMPANY_ID = 'company-1';
const COMPANY_ROW = { id: COMPANY_ID, name: 'Acme' };

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

describe('WebhooksService — secret encryption', () => {
  let service: WebhooksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService();
  });

  describe('create', () => {
    it('never stores the plaintext secret in the row handed to Prisma', async () => {
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.create.mockImplementation(async ({ data }) =>
        makeWebhook({ secret: data.secret }),
      );

      await service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook', secret: 'my-hmac-secret' });

      const persisted = mockedPrisma.webhook.create.mock.calls[0][0].data.secret;
      expect(persisted).not.toBe('my-hmac-secret');
      expect(isEncryptedWebhookSecret(persisted)).toBe(true);
      expect(decryptJson<string>(persisted)).toBe('my-hmac-secret');
    });

    it('still returns the plaintext secret once, to the caller who just supplied it', async () => {
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.create.mockImplementation(async ({ data }) =>
        makeWebhook({ secret: data.secret }),
      );

      const { webhook } = await service.create(COMPANY_ID, {
        url: 'https://8.8.8.8/hook',
        secret: 'my-hmac-secret',
      });

      expect(webhook.secret).toBe('my-hmac-secret');
    });

    it('leaves a webhook created with no secret exactly as before (empty string, never encrypted)', async () => {
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.create.mockImplementation(async ({ data }) =>
        makeWebhook({ secret: data.secret }),
      );

      await service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook' });

      expect(mockedPrisma.webhook.create.mock.calls[0][0].data.secret).toBe('');
    });
  });

  describe('update', () => {
    it('encrypts a newly supplied secret', async () => {
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ secret: null }));
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.update.mockImplementation(async ({ data }) =>
        makeWebhook({ secret: data.secret }),
      );

      await service.update(COMPANY_ID, 'wh-1', { secret: 'new-secret' });

      const persisted = mockedPrisma.webhook.update.mock.calls[0][0].data.secret;
      expect(isEncryptedWebhookSecret(persisted)).toBe(true);
      expect(decryptJson<string>(persisted)).toBe('new-secret');
    });

    it('never re-encrypts an already-encrypted secret on an update that does not touch it', async () => {
      const alreadyEncrypted = encryptJson('untouched-secret');
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ secret: alreadyEncrypted }));
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.update.mockImplementation(async ({ data }) =>
        makeWebhook({ secret: data.secret }),
      );

      await service.update(COMPANY_ID, 'wh-1', { url: 'https://8.8.8.8/other' });

      const persisted = mockedPrisma.webhook.update.mock.calls[0][0].data.secret;
      // Byte-for-byte the SAME ciphertext — proof it was passed through, not decrypted-then-re-encrypted
      // (which would still decrypt correctly but produce a different blob, masking a double-encryption bug).
      expect(persisted).toBe(alreadyEncrypted);
      expect(decryptJson<string>(persisted)).toBe('untouched-secret');
    });
  });

  describe('send — decrypts before signing', () => {
    afterEach(() => jest.restoreAllMocks());

    it('signs with the decrypted secret, not the stored ciphertext', async () => {
      const plainSecret = 'signing-secret';
      const encrypted = encryptJson(plainSecret);
      let capturedBody = '';
      let capturedSignature: string | null = null;
      jest.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
        capturedBody = init.body;
        capturedSignature = init.headers['X-Webhook-Signature'] ?? null;
        return { ok: true } as Response;
      });
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', secret: encrypted });

      await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      const expected = createHmac('sha256', plainSecret).update(capturedBody).digest('hex');
      expect(capturedSignature).toBe(expected);
    });

    it('still signs correctly with a legacy plaintext secret (pre-migration row)', async () => {
      let capturedSignature: string | null = null;
      let capturedBody = '';
      jest.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
        capturedBody = init.body;
        capturedSignature = init.headers['X-Webhook-Signature'] ?? null;
        return { ok: true } as Response;
      });
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', secret: 'legacy-plaintext-secret' });

      await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      const expected = createHmac('sha256', 'legacy-plaintext-secret').update(capturedBody).digest('hex');
      expect(capturedSignature).toBe(expected);
    });

    it('sends unsigned rather than crash when an encrypted secret cannot be decrypted (wrong/rotated key)', async () => {
      const encryptedUnderAnotherKey = encryptJson('some-secret'); // still valid shape, just simulate corruption below
      const corrupted = encryptedUnderAnotherKey.replace('"ct":"', '"ct":"XX');
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', secret: corrupted });

      const results = await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([true]); // delivery still happens...
      const opts = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(opts.headers['X-Webhook-Signature']).toBeUndefined(); // ...just without a (garbled) signature
    });
  });
});

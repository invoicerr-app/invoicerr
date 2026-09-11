/**
 * SECURITY_AUDIT.md finding #2 (SSRF via outbound webhook URL) — the SERVICE-level half of the
 * fix. `webhook-url-guard.spec.ts` owns the guard's own decision logic (schemes, literal IPs, DNS
 * resolution, rebinding); this file proves `WebhooksService` actually calls it at the two points the
 * finding named: create/update (before the row is ever persisted) and send (right before every
 * dispatch, so a webhook already sitting in the database — e.g. one written before this fix existed —
 * cannot slip a request out). Only `@/prisma/prisma.service` is mocked, the same discipline
 * `channels.service.spec.ts` already established for this kind of service-in-isolation test.
 *
 * Every case here uses a LITERAL IP (never a hostname) so it never touches DNS — that keeps this
 * file decoupled from `dns.lookup` mocking, which is `webhook-url-guard.spec.ts`'s job alone.
 */
// `WebhooksService`'s own driver list unconditionally constructs `new DiscordDriver()`, and
// `discord.driver.ts` imports `@teever/ez-hook` — a pure-ESM JSR package ts-jest cannot compile (see
// the known "ClientsModule inimportable sous ts-jest" limit; `clients.vat-validation.spec.ts`
// hits the identical wall one level up and works around it the same way: a FACTORY mock at the exact
// import path, so the real `discord.driver.ts` is never `require()`'d/transpiled at all). Unlike
// that file, this suite constructs `WebhooksService` itself, so the mock has to sit one level
// deeper — at `./drivers/discord.driver` rather than at the dispatcher.
jest.mock('./drivers/discord.driver', () => ({
  __esModule: true,
  DiscordDriver: class {
    supports() {
      return false;
    }
    async send() {
      return true;
    }
  },
}));

import { HttpException, HttpStatus } from '@nestjs/common';

import { PluginsService } from '../plugins/plugins.service';
import { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhooksService } from './webhooks.service';
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

describe('WebhooksService — SSRF guard wired into create/update/send', () => {
  let service: WebhooksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService({} as PluginsService);
  });

  describe('create', () => {
    it('refuses an internal URL with a named 400, before touching Prisma at all', async () => {
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);

      await expect(
        service.create(COMPANY_ID, { url: 'http://169.254.169.254/latest/meta-data/' }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        message: 'webhook URL must be a public http(s) endpoint',
      });

      // Fails BEFORE either write: no company lookup, no row ever created for this URL.
      expect(mockedPrisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockedPrisma.webhook.create).not.toHaveBeenCalled();
    });

    it('refuses a private RFC1918 URL the same way', async () => {
      await expect(service.create(COMPANY_ID, { url: 'http://10.0.0.5/hook' })).rejects.toThrow(
        HttpException,
      );
      expect(mockedPrisma.webhook.create).not.toHaveBeenCalled();
    });

    it('creates a webhook whose URL is a public address', async () => {
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.create.mockResolvedValue(makeWebhook());

      const { webhook } = await service.create(COMPANY_ID, { url: 'https://8.8.8.8/hook' });

      expect(webhook.url).toBe('https://8.8.8.8/hook');
      expect(mockedPrisma.webhook.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('refuses repointing an existing webhook at an internal URL', async () => {
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook());

      await expect(
        service.update(COMPANY_ID, 'wh-1', { url: 'http://192.168.1.1/hook' }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        message: 'webhook URL must be a public http(s) endpoint',
      });

      expect(mockedPrisma.webhook.update).not.toHaveBeenCalled();
    });

    it('does not re-validate the URL when the update leaves it untouched', async () => {
      // Deliberate: a row already in the table (e.g. from before this guard existed) can still have
      // its non-URL fields edited without being newly rejected for a URL nobody is trying to change.
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook({ url: 'http://127.0.0.1/legacy' }));
      mockedPrisma.company.findUniqueOrThrow.mockResolvedValue(COMPANY_ROW);
      mockedPrisma.webhook.update.mockResolvedValue(makeWebhook({ url: 'http://127.0.0.1/legacy' }));

      await expect(service.update(COMPANY_ID, 'wh-1', { secret: 'new-secret' })).resolves.toBeDefined();
      expect(mockedPrisma.webhook.update).toHaveBeenCalledTimes(1);
    });

    it('validates the URL when it IS being changed, even to another bad one', async () => {
      mockedPrisma.webhook.findFirst.mockResolvedValue(makeWebhook());

      await expect(service.update(COMPANY_ID, 'wh-1', { url: 'file:///etc/passwd' })).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('send — re-validated right before every dispatch', () => {
    afterEach(() => jest.restoreAllMocks());

    it('skips a webhook whose stored URL is internal, without ever calling fetch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const webhook = makeWebhook({ url: 'http://169.254.169.254/hook', type: WebhookType.GENERIC });

      const results = await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([false]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('still dispatches to a webhook whose stored URL is public', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', type: WebhookType.GENERIC });

      const results = await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([true]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('one internal webhook does not block delivery to the other, valid ones in the same batch', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const bad = makeWebhook({ id: 'wh-bad', url: 'http://10.0.0.5/hook' });
      const good = makeWebhook({ id: 'wh-good', url: 'https://8.8.8.8/hook' });

      const results = await service.send([bad, good], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([false, true]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

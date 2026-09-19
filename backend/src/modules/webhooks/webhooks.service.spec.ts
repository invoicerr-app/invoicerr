/**
 * SSRF via an outbound webhook URL — the SERVICE-level half of the guard. A webhook `url` is set by
 * a tenant (an OWNER/ADMIN, or a compromised account, or in a multi-tenant deployment another tenant
 * entirely), yet the HTTP request it triggers is fired by this server's own network — unvalidated,
 * it is a live SSRF primitive against internal infrastructure. `webhook-url-guard.spec.ts` owns the
 * guard's own decision logic (schemes, literal IPs, DNS resolution, rebinding); this file proves
 * `WebhooksService` actually calls it at the two points that matter: create/update (before the row
 * is ever persisted) and send (right before every dispatch, so a webhook already sitting in the
 * database — e.g. one written before this guard existed — cannot slip a request out). Only
 * `@/prisma/prisma.service` is mocked, the same discipline
 * `channels.service.spec.ts` already established for this kind of service-in-isolation test.
 *
 * Every case here uses a LITERAL IP (never a hostname) so it never touches DNS — that keeps this
 * file decoupled from `dns.lookup` mocking, which is `webhook-url-guard.spec.ts`'s job alone.
 *
 * `WebhooksService`'s own driver list unconditionally constructs `new DiscordDriver()`, which used
 * to drag in `@teever/ez-hook` (a pure-ESM JSR package ts-jest could not compile — the
 * "ClientsModule inimportable sous ts-jest" item) and forced a factory mock at `./drivers/
 * discord.driver` just to import this file at all. `discord.driver.ts` now owns a plain `fetch()`
 * call instead, so the real driver is used here like every other one — none of the cases below ever
 * create a DISCORD-typed webhook, so it is constructed but never actually dispatches through.
 */

import { vi, type Mock } from 'vitest';

import { HttpException, HttpStatus } from '@nestjs/common';

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
    vi.clearAllMocks();
    service = new WebhooksService();
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
    afterEach(() => vi.restoreAllMocks());

    it('skips a webhook whose stored URL is internal, without ever calling fetch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const webhook = makeWebhook({ url: 'http://169.254.169.254/hook', type: WebhookType.GENERIC });

      const results = await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([false]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('still dispatches to a webhook whose stored URL is public', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', type: WebhookType.GENERIC });

      const results = await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([true]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('connects through the address just validated (pinned dispatcher), not a second DNS lookup fetch would do on its own', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const webhook = makeWebhook({ url: 'https://8.8.8.8/hook', type: WebhookType.GENERIC });

      await service.send([webhook], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      // THE DNS-rebinding fix: `GenericDriver` must receive and forward the `dispatcher`
      // `assertPublicWebhookUrl` handed back, not let `fetch` resolve `8.8.8.8`'s (non-)hostname a
      // second, independent time. A literal IP has nothing to "look up" either way, so the one thing
      // actually checkable here is that the option reached `fetch` at all — `outbound-url.spec.ts`
      // owns the exhaustive proof that connecting through it actually lands on the pinned address.
      const opts = fetchSpy.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
      expect(opts.dispatcher).toBeDefined();
    });

    it('one internal webhook does not block delivery to the other, valid ones in the same batch', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      const bad = makeWebhook({ id: 'wh-bad', url: 'http://10.0.0.5/hook' });
      const good = makeWebhook({ id: 'wh-good', url: 'https://8.8.8.8/hook' });

      const results = await service.send([bad, good], WebhookEvent.WEBHOOK_CREATED, { company: COMPANY_ROW });

      expect(results).toEqual([false, true]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

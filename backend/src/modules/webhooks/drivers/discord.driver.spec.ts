/**
 * Pins `DiscordDriver`'s observable behavior after the `@teever/ez-hook` removal (the
 * "ClientsModule inimportable sous ts-jest" item — see `discord.driver.ts`'s own header): the exact
 * JSON payload Discord's webhook API receives (`POST /webhooks/{id}/{token}` —
 * https://discord.com/developers/docs/resources/webhook#execute-webhook), and the bounded-retry
 * handling of a 429 response (https://discord.com/developers/docs/topics/rate-limits: `Retry-After`
 * header in seconds, mirrored by a `retry_after` float in the JSON body). Field-for-field this
 * matches what the removed `@teever/ez-hook` version sent (`Webhook.toObject()`/`Embed.toObject()`
 * in the now-uninstalled package) — only the transport changed.
 */

import { vi } from 'vitest';

import { DiscordDriver } from './discord.driver';
import { WebhookEvent, WebhookType } from '../../../../prisma/generated/prisma/client';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('DiscordDriver', () => {
  afterEach(() => vi.restoreAllMocks());

  it('supports only the DISCORD webhook type', () => {
    const driver = new DiscordDriver();
    expect(driver.supports(WebhookType.DISCORD)).toBe(true);
    expect(driver.supports(WebhookType.GENERIC)).toBe(false);
  });

  it('posts the exact Discord payload shape for a known event', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://discord.com/api/webhooks/1/abc' },
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [calledUrl, options] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://discord.com/api/webhooks/1/abc');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    // SSRF hardening (webhook-driver.interface.ts's own contract) — see also
    // webhook-fetch-hardening.spec.ts, which covers this driver alongside the others.
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(options?.body as string);
    expect(body.username).toBe('Invoicerr');
    expect(body.avatar_url).toBe('https://invoicerr.app/favicon.png');
    expect(body.content).toBeUndefined();
    expect(body.embeds).toHaveLength(1);

    const embed = body.embeds[0];
    expect(embed.type).toBe('rich');
    expect(embed.title).toBe('🪝 Webhook Created');
    expect(embed.description).toBe('Type: DISCORD\nURL: https://discord.com/api/webhooks/1/abc');
    expect(embed.color).toBe(0x8b5cf6);
    expect(typeof embed.timestamp).toBe('string');
    expect(new Date(embed.timestamp).toString()).not.toBe('Invalid Date');
    expect(embed.author).toEqual({
      name: 'Invoicerr',
      url: 'https://invoicerr.app',
      icon_url: 'https://invoicerr.app/favicon.png',
    });
    expect(embed.footer).toEqual({
      text: 'Invoicerr Webhooks',
      icon_url: 'https://invoicerr.app/favicon.png',
    });
    expect(embed.fields).toBeUndefined();
  });

  it('falls back to the generic style for an event with no dedicated entry', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: 'SOME_UNMAPPED_EVENT',
    });

    expect(ok).toBe(true);
  });

  it('adds an "Entreprise" field only when the payload carries a company name', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
      company: { name: 'Acme Corp' },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.embeds[0].fields).toEqual([{ name: 'Entreprise', value: 'Acme Corp', inline: true }]);
  });

  it('retries once, after a bounded wait, on a 429 carrying a Retry-After header', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(429, { message: 'rate limited', retry_after: 0.001 }, { 'retry-after': '0.001' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to the JSON body's retry_after when the header is absent", async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(429, { message: 'rate limited', retry_after: 0.001 }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up without a second call when retry_after exceeds the bounded wait', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(429, { message: 'rate limited', retry_after: 10 }, { 'retry-after': '10' }),
      );

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
    });

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never retries a second 429 in a row (one bounded retry only)', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(429, { retry_after: 0.001 }, { 'retry-after': '0.001' }));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
    });

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reports a non-429 failure status as a failed send, without retrying', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}));

    const ok = await new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
      event: WebhookEvent.WEBHOOK_CREATED,
      webhook: { type: 'DISCORD', url: 'https://x' },
    });

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('catches a network error and reports a failed send instead of throwing — never fatal to the event', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network unreachable'));

    await expect(
      new DiscordDriver().send('https://discord.com/api/webhooks/1/abc', {
        event: WebhookEvent.WEBHOOK_CREATED,
        webhook: { type: 'DISCORD', url: 'https://x' },
      }),
    ).resolves.toBe(false);
  });
});

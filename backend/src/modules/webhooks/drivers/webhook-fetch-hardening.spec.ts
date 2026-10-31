/**
 * SSRF hardening at send time: a validated endpoint can still answer with a 30x to an internal
 * address. Every driver owning a `fetch()` must set `redirect: 'manual'` and the bounded timeout, so
 * removing either turns this red.
 */

import { vi } from 'vitest';

import { DiscordDriver } from './discord.driver';
import { GenericDriver } from './generic.driver';
import { SlackDriver } from './slack.driver';
import { TeamsDriver } from './teams.driver';
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { ZapierDriver } from './zapier.driver';

describe('drivers hardening their own fetch() call against redirect-based SSRF', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GenericDriver never follows redirects and bounds the wait', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new GenericDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('SlackDriver (ChatWebhookDriver family — also Mattermost/Rocket.Chat) does the same', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new SlackDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('TeamsDriver does the same', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new TeamsDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('ZapierDriver does the same', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new ZapierDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("DiscordDriver does the same (full payload shape is discord.driver.spec.ts's job)", async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    await new DiscordDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('an opaque-redirect response (what "redirect: manual" turns a 30x into) is reported as a failed send', async () => {
    // A `fetch` with `redirect: 'manual'` resolves an opaque-redirect response instead of following
    // it: status 0, ok false. The driver must not mistake that for success.
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 0, type: 'opaqueredirect' } as Response);

    const ok = await new GenericDriver().send('https://hooks.example.com/x', {
      event: WebhookEvent.WEBHOOK_CREATED,
    });

    expect(ok).toBe(false);
  });
});

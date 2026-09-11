/**
 * SECURITY_AUDIT.md finding #2 (SSRF), correctif item 3 — the send-time half that URL validation
 * alone cannot cover: a webhook endpoint that passed `webhook-url-guard.ts` at request time could
 * still answer with a 30x pointing at an internal address, and following it would land the exact
 * same SSRF the guard was built to stop. Every driver that owns its own `fetch()` call must set
 * `redirect: 'manual'` (never follow) and a bounded timeout — this file is what turns "someone
 * deleted that option while refactoring" into a red test instead of a silent regression.
 *
 * `DiscordDriver` is NOT covered here, even for the `timeoutMs` it does accept: `discord.driver.ts`
 * imports `@teever/ez-hook`, a pure-ESM JSR package ts-jest cannot compile (the
 * pre-existing "ClientsModule inimportable sous ts-jest" note) — merely IMPORTING the file, even to
 * mock the package away, fails ts-jest's own type-check of that import statement. Its hardening
 * (`hook.addEmbed(embed).send({ timeoutMs: WEBHOOK_FETCH_TIMEOUT_MS })`, and the redirect-following
 * gap noted in its own file) is reviewed by eye only.
 */
import { GenericDriver } from './generic.driver';
import { SlackDriver } from './slack.driver';
import { TeamsDriver } from './teams.driver';
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { ZapierDriver } from './zapier.driver';

describe('drivers hardening their own fetch() call against redirect-based SSRF', () => {
  afterEach(() => jest.restoreAllMocks());

  it('GenericDriver never follows redirects and bounds the wait', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new GenericDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('SlackDriver (ChatWebhookDriver family — also Mattermost/Rocket.Chat) does the same', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new SlackDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('TeamsDriver does the same', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new TeamsDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('ZapierDriver does the same', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await new ZapierDriver().send('https://hooks.example.com/x', { event: WebhookEvent.WEBHOOK_CREATED });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('an opaque-redirect response (what "redirect: manual" turns a 30x into) is reported as a failed send', async () => {
    // A `fetch` with `redirect: 'manual'` resolves an opaque-redirect response instead of following
    // it: status 0, ok false. The driver must not mistake that for success.
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 0, type: 'opaqueredirect' } as Response);

    const ok = await new GenericDriver().send('https://hooks.example.com/x', {
      event: WebhookEvent.WEBHOOK_CREATED,
    });

    expect(ok).toBe(false);
  });
});

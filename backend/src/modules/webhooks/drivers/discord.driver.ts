import type { Dispatcher } from 'undici';

import { EVENT_STYLES, formatPayloadForEvent } from './event-formatters';
import { WebhookEvent, WebhookType } from '../../../../prisma/generated/prisma/client';

import { Logger } from '@nestjs/common';
import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';

/**
 * A bound on how long a single Discord 429 is worth waiting out. `webhooks.service.ts#send` awaits
 * every driver inside one `Promise.all`, so an unbounded wait here would hang the whole batch behind
 * one rate-limited channel — past this bound the send is reported as failed instead.
 */
const MAX_RATE_LIMIT_WAIT_MS = 5_000;

/** The subset of Discord's documented embed object this driver populates. */
interface DiscordEmbed {
  title: string;
  type: 'rich';
  description: string;
  timestamp: string;
  color: number;
  author: { name: string; url: string; icon_url: string };
  footer: { text: string; icon_url: string };
  fields?: Array<{ name: string; value: string; inline: boolean }>;
}

function hexToDiscordColor(hex: string): number {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  return Number.parseInt(normalized, 16);
}

/**
 * Talks to Discord's webhook API directly — `POST` a JSON `{username, avatar_url, embeds}` body to
 * the webhook URL, per Discord's own docs
 * (https://discord.com/developers/docs/resources/webhook#execute-webhook: `content` capped at 2000
 * chars, up to 10 embeds) — instead of going through `@teever/ez-hook`. That dependency was removed
 * because it is a pure-ESM JSR package ts-jest cannot compile (the "ClientsModule inimportable sous
 * ts-jest" item: `ClientsModule → WebhooksModule → DiscordDriver → @teever/ez-hook`, which broke
 * every spec importing `ClientsModule`/`WebhooksModule` as a *module* rather than constructing the
 * service directly — see `clients.module.spec.ts` and the now-obsolete workarounds this removal
 * makes unnecessary in `webhooks.service.spec.ts` and `webhook-fetch-hardening.spec.ts`).
 *
 * Observable output (embed title/description/color/author/footer/fields per event) is unchanged
 * from the `@teever/ez-hook` version this replaces — only the transport changed. `discord.driver.
 * spec.ts` pins the exact payload shape.
 */
export class DiscordDriver implements WebhookDriver {
  private readonly logger = new Logger(DiscordDriver.name);

  supports(type: WebhookType) {
    return type === WebhookType.DISCORD;
  }

  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const eventType = payload.event as WebhookEvent;
    const eventStyle = EVENT_STYLES[eventType] || {
      color: '#5865F2',
      emoji: '📢',
      title: 'Event',
    };

    const description = formatPayloadForEvent(eventType, payload);

    const embed: DiscordEmbed = {
      title: `${eventStyle.emoji} ${eventStyle.title}`,
      type: 'rich',
      description,
      timestamp: new Date().toISOString(),
      color: hexToDiscordColor(eventStyle.color),
      author: {
        name: 'Invoicerr',
        url: 'https://invoicerr.app',
        icon_url: 'https://invoicerr.app/favicon.png',
      },
      footer: {
        text: 'Invoicerr Webhooks',
        icon_url: 'https://invoicerr.app/favicon.png',
      },
    };

    if (payload.company?.name) {
      embed.fields = [{ name: 'Entreprise', value: payload.company.name, inline: true }];
    }

    const body = JSON.stringify({
      username: 'Invoicerr',
      avatar_url: 'https://invoicerr.app/favicon.png',
      embeds: [embed],
    });

    return this.postToDiscord(url, body, dispatcher);
  }

  /**
   * One bounded retry on a 429, never a thrown error — a Discord delivery failure must never be
   * fatal to the event that triggered it (`WebhooksService#send` treats a `false` return as "this
   * one webhook failed", never as a reason to abort the rest of the batch).
   */
  private async postToDiscord(
    url: string,
    body: string,
    dispatcher?: Dispatcher,
    isRetry = false,
  ): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // Never follow redirects — the same SSRF hardening every other driver's own fetch() call
        // applies (webhook-driver.interface.ts's own header). Discord's real endpoint never
        // redirects; this only ever matters for a compromised/malicious one.
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
        // See `webhook-driver.interface.ts`'s own header on why this must never be omitted.
        dispatcher,
      } as RequestInit);
    } catch (err) {
      this.logger.warn(`Discord webhook send failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }

    if (res.status === 429 && !isRetry) {
      const waitMs = await this.readRetryAfterMs(res);
      if (waitMs !== undefined && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.postToDiscord(url, body, dispatcher, true);
      }
      this.logger.warn(
        `Discord webhook rate-limited past the bounded retry window (retry_after=${waitMs ?? 'unknown'}ms)`,
      );
      return false;
    }

    return res.ok;
  }

  /**
   * Discord's rate-limit response (topics/rate-limits) carries the wait both as the `Retry-After`
   * header (seconds) and as a `retry_after` float in the JSON body — the header is cheaper to read
   * and present on every 429, so it is tried first; the body is a fallback for a gateway/proxy that
   * strips it.
   */
  private async readRetryAfterMs(res: Response): Promise<number | undefined> {
    const header = res.headers.get('retry-after');
    if (header) {
      const seconds = Number.parseFloat(header);
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
    try {
      const body = (await res.json()) as { retry_after?: number };
      if (typeof body?.retry_after === 'number') return body.retry_after * 1000;
    } catch {
      // Body wasn't JSON (or already consumed) — no retry_after to read.
    }
    return undefined;
  }
}

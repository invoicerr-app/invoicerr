import type { Dispatcher } from 'undici';

import { EVENT_STYLES, formatPayloadForEvent } from './event-formatters';
import { WebhookEvent, WebhookType } from '../../../../prisma/generated/prisma/client';

import { Logger } from '@nestjs/common';
import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';

import { instanceIcon, instanceUrl } from './chat-webhook.driver';

/**
 * Bound on how long one Discord 429 is worth waiting out: `send` awaits every driver in one batch,
 * so an unbounded wait would hang the others behind one rate-limited channel.
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
 * Discord's webhook API directly: POST a `{username, avatar_url, embeds}` body at the webhook URL.
 * Docs: https://discord.com/developers/docs/resources/webhook#execute-webhook.
 * `discord.driver.spec.ts` pins the payload shape.
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
        url: instanceUrl(),
        icon_url: instanceIcon(),
      },
      footer: {
        text: 'Invoicerr Webhooks',
        icon_url: instanceIcon(),
      },
    };

    if (payload.company?.name) {
      embed.fields = [{ name: 'Entreprise', value: payload.company.name, inline: true }];
    }

    const body = JSON.stringify({
      username: 'Invoicerr',
      avatar_url: instanceIcon(),
      embeds: [embed],
    });

    return this.postToDiscord(url, body, dispatcher);
  }

  /**
   * One bounded retry on a 429, never a thrown error: one failed webhook must not abort the batch.
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
        // Never follow redirects, like every driver's own fetch call (webhook-driver.interface.ts).
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
        // Pins the address validated by the guard; see webhook-driver.interface.ts.
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
   * Discord sends the wait both as a `Retry-After` header (seconds) and as a `retry_after` float in
   * the body: the header is tried first, the body covers a proxy that strips it.
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

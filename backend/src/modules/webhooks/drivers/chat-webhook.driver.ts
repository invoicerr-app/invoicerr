import type { Dispatcher } from 'undici';

import { EVENT_STYLES, formatPayloadForEvent } from './event-formatters';
import { WebhookEvent, WebhookType } from '../../../../prisma/generated/prisma/client';

import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';

/**
 * The icon and link a chat message carries, taken from THIS instance: a self-hosted deployment must
 * not send its users to a site where they have no account, nor ask a closed network to fetch an
 * image from the open internet. `favicon.svg` because every deployment serves it.
 */
export const instanceUrl = (): string => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const instanceIcon = (): string => `${instanceUrl()}/favicon.svg`;

export interface ChatField {
  title: string;
  value: string;
  short?: boolean;
}

interface ChatAttachmentData {
  title?: string;
  color?: string;
  text?: string;
  fields?: ChatField[];
  footer?: string;
  footer_icon?: string;
}

/**
 * Shared attachment builder: Slack, Mattermost and Rocket.Chat all accept this shape.
 */
export class ChatAttachment {
  private data: ChatAttachmentData = {};

  setTitle(title: string): this {
    this.data.title = title;
    return this;
  }

  setColor(color: string): this {
    this.data.color = color;
    return this;
  }

  setText(text: string): this {
    this.data.text = text;
    return this;
  }

  addField(field: ChatField): this {
    if (!this.data.fields) this.data.fields = [];
    this.data.fields.push(field);
    return this;
  }

  setFooter(text: string, icon?: string): this {
    this.data.footer = text;
    if (icon) this.data.footer_icon = icon;
    return this;
  }

  build(): ChatAttachmentData {
    return this.data;
  }
}

/**
 * Shared sender: platforms differ only by the key carrying the bot icon (`icon_url` for
 * Slack/Mattermost, `avatar` for Rocket.Chat).
 */
export class ChatWebhook {
  private attachments: ChatAttachment[] = [];
  private text: string = '';
  private username: string = '';
  private icon: string = '';

  constructor(
    private readonly webhook: string,
    private readonly iconKey: 'icon_url' | 'avatar',
  ) {}

  setText(text: string): this {
    this.text = text;
    return this;
  }

  setUsername(username: string): this {
    this.username = username;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  addAttachment(attachment: ChatAttachment): this {
    this.attachments.push(attachment);
    return this;
  }

  async send(dispatcher?: Dispatcher): Promise<Response> {
    const payload: Record<string, unknown> = {
      text: this.text,
      attachments: this.attachments.map((attachment) => attachment.build()),
    };

    if (this.username) payload.username = this.username;
    if (this.icon) payload[this.iconKey] = this.icon;

    const response = await fetch(this.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      // Pins the address validated by the guard; see webhook-driver.interface.ts.
      dispatcher,
    } as RequestInit);

    this.text = '';
    this.attachments = [];
    this.username = '';
    this.icon = '';

    return response;
  }
}

/**
 * Common logic for Slack-compatible platforms: only the type, fallback colour and icon key differ.
 */
export abstract class ChatWebhookDriver implements WebhookDriver {
  protected abstract readonly type: WebhookType;
  protected abstract readonly fallbackColor: string;
  protected abstract readonly iconKey: 'icon_url' | 'avatar';

  supports(type: WebhookType) {
    return type === this.type;
  }

  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const hook = new ChatWebhook(url, this.iconKey);

    const eventType = payload.event as WebhookEvent;
    const eventStyle = EVENT_STYLES[eventType] || {
      color: this.fallbackColor,
      emoji: '📢',
      title: 'Event',
    };

    const description = formatPayloadForEvent(eventType, payload);

    const attachment = new ChatAttachment()
      .setTitle(`${eventStyle.emoji} ${eventStyle.title}`)
      .setText(description)
      .setColor(eventStyle.color)
      .setFooter(`Invoicerr Webhooks • ${new Date().toLocaleString()}`, instanceIcon());

    if (payload.company?.name) {
      attachment.addField({ title: 'Entreprise', value: payload.company.name, short: true });
    }

    const res = await hook
      .setUsername('Invoicerr')
      .setIcon(instanceIcon())
      .addAttachment(attachment)
      .send(dispatcher);

    return res.ok;
  }
}

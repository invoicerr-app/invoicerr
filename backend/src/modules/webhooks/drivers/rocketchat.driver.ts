import { EVENT_STYLES, formatPayloadForEvent } from "./event-formatters";
import { WebhookEvent, WebhookType } from "../../../../prisma/generated/prisma/client";

import { WebhookDriver } from "./webhook-driver.interface";

export interface RocketChatField {
  title: string;
  value: string;
  short?: boolean;
}

export class RocketChatAttachment {
  private data: Record<string, any> = {};

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

  addField(field: RocketChatField): this {
    if (!this.data.fields) this.data.fields = [];
    this.data.fields.push(field);
    return this;
  }

  addFields(...fields: RocketChatField[]): this {
    if (!this.data.fields) this.data.fields = [];
    this.data.fields.push(...fields);
    return this;
  }

  setImage(url: string): this {
    this.data.image_url = url;
    return this;
  }

  setThumb(url: string): this {
    this.data.thumb_url = url;
    return this;
  }

  setFooter(text: string, icon?: string): this {
    this.data.footer = text;
    if (icon) this.data.footer_icon = icon;
    return this;
  }

  build(): Record<string, any> {
    return this.data;
  }
}

export class RocketChatWebhook {
  private webhook: string;
  private attachments: RocketChatAttachment[] = [];
  private text: string = '';
  private username: string = '';
  private avatar: string = '';

  constructor(webhookUrl: string) {
    this.webhook = webhookUrl;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  setUsername(username: string): this {
    this.username = username;
    return this;
  }

  setAvatar(avatar: string): this {
    this.avatar = avatar;
    return this;
  }

  addAttachment(attachment: RocketChatAttachment): this {
    this.attachments.push(attachment);
    return this;
  }

  async send(): Promise<Response> {
    const payload: any = {
      text: this.text,
      attachments: this.attachments.map(att => att.build())
    };

    if (this.username) payload.username = this.username;
    if (this.avatar) payload.avatar = this.avatar;

    const response = await fetch(this.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    this.text = '';
    this.attachments = [];
    this.username = '';
    this.avatar = '';

    return response;
  }
}

export class RocketChatDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.ROCKETCHAT;
  }

  async send(url: string, payload: any): Promise<boolean> {
    const hook = new RocketChatWebhook(url);

    const eventType = payload.event as WebhookEvent;
    const eventStyle = EVENT_STYLES[eventType] || {
      color: "#F3F4F6",
      emoji: "📢",
      title: "Event"
    };

    const description = formatPayloadForEvent(eventType, payload);

    const attachment = new RocketChatAttachment()
      .setTitle(`${eventStyle.emoji} ${eventStyle.title}`)
      .setText(description)
      .setColor(eventStyle.color)
      .setFooter(
        `Invoicerr Webhooks • ${new Date().toLocaleString()}`,
        'https://invoicerr.app/favicon.png'
      )

    if (payload.company?.name) {
      attachment.addField({ title: 'Entreprise', value: payload.company.name, short: true });
    }

    const res = await hook
      .setUsername('Invoicerr')
      .setAvatar('https://invoicerr.app/favicon.png')
      .addAttachment(attachment)
      .send();

    return res.ok;
  }
}

import { EVENT_STYLES, formatPayloadForEvent } from "./event-formatters";
import { WebhookEvent, WebhookType } from "../../../../prisma/generated/prisma/client";

import { WebhookDriver } from "./webhook-driver.interface";

export interface CardField {
  title: string;
  value: string;
  short?: boolean;
}

export class Card {
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

  setPretext(pretext: string): this {
    this.data.pretext = pretext;
    return this;
  }

  addField(field: CardField): this {
    if (!this.data.fields) this.data.fields = [];
    this.data.fields.push(field);
    return this;
  }

  addFields(...fields: CardField[]): this {
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

export class MattermostWebhook {
  private webhook: string;
  private cards: Card[] = [];
  private text: string = '';
  private username: string = '';
  private iconUrl: string = '';

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

  setIconUrl(iconUrl: string): this {
    this.iconUrl = iconUrl;
    return this;
  }

  addCard(card: Card): this {
    this.cards.push(card);
    return this;
  }

  async send(): Promise<Response> {
    const payload: any = {
      text: this.text,
      attachments: this.cards.map(card => card.build())
    };

    if (this.username) payload.username = this.username;
    if (this.iconUrl) payload.icon_url = this.iconUrl;

    const response = await fetch(this.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    this.text = '';
    this.cards = [];
    this.username = '';
    this.iconUrl = '';

    return response;
  }
}


export class MattermostDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.MATTERMOST;
  }

  async send(url: string, payload: any): Promise<boolean> {
    const hook = new MattermostWebhook(url);

    const eventType = payload.event as WebhookEvent;
    const eventStyle = EVENT_STYLES[eventType] || {
      color: "#5865F2",
      emoji: "📢",
      title: "Event"
    };

    const description = formatPayloadForEvent(eventType, payload);

    const card = new Card()
      .setTitle(`${eventStyle.emoji} ${eventStyle.title}`)
      .setText(description)
      .setColor(eventStyle.color)
      .setFooter(
        `Invoicerr Webhooks • ${new Date().toLocaleString()}`,
        'https://invoicerr.app/favicon.png'
      )

    if (payload.company?.name) {
      card.addField({ title: 'Entreprise', value: payload.company.name, short: true });
    }

    const res = await hook
      .setUsername('Invoicerr')
      .setIconUrl('https://invoicerr.app/favicon.png')
      .addCard(card)
      .send();

    return res.ok;
  }
}

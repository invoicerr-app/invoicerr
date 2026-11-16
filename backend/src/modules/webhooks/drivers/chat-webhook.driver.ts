import type { Dispatcher } from 'undici';

import { describeEvent, instanceIcon } from './event-message';
import { postWebhookJson, WebhookDriver } from './webhook-driver.interface';

/**
 * Common logic for Slack-compatible platforms (Slack, Mattermost, Rocket.Chat all accept this
 * attachment shape): only the fallback colour and the key carrying the bot icon differ (`icon_url`
 * for Slack/Mattermost, `avatar` for Rocket.Chat).
 */
export abstract class ChatWebhookDriver implements WebhookDriver {
  protected abstract readonly fallbackColor: string;
  protected abstract readonly iconKey: 'icon_url' | 'avatar';

  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const message = describeEvent(payload, this.fallbackColor);

    const attachment = {
      title: message.title,
      text: message.description,
      color: message.color,
      footer: `Invoicerr Webhooks • ${new Date().toLocaleString()}`,
      footer_icon: instanceIcon(),
      ...(message.companyName
        ? { fields: [{ title: 'Entreprise', value: message.companyName, short: true }] }
        : {}),
    };

    const body = JSON.stringify({
      text: '',
      attachments: [attachment],
      username: 'Invoicerr',
      [this.iconKey]: instanceIcon(),
    });

    const res = await postWebhookJson(url, body, dispatcher);
    return res.ok;
  }
}

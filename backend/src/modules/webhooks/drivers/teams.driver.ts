import type { Dispatcher } from 'undici';

import { describeEvent } from './event-message';
import { postWebhookJson, WebhookDriver } from './webhook-driver.interface';

/** A Teams incoming-webhook message wrapping one Adaptive Card 1.2. */
export class TeamsDriver implements WebhookDriver {
  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const message = describeEvent(payload, 'accent');

    const cardBody: Record<string, unknown>[] = [
      { type: 'TextBlock', text: message.title, weight: 'bolder', size: 'large', color: message.color },
      { type: 'TextBlock', text: message.description, weight: 'default' },
      {
        type: 'TextBlock',
        text: `Invoicerr Webhooks • ${new Date().toLocaleString()}`,
        size: 'small',
        weight: 'lighter',
        color: 'light',
        spacing: 'large',
      },
    ];

    if (message.companyName) {
      cardBody.push({ type: 'FactSet', facts: [{ name: 'Entreprise:', value: message.companyName }] });
    }

    const body = JSON.stringify({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.2',
            body: cardBody,
          },
        },
      ],
    });

    const res = await postWebhookJson(url, body, dispatcher);
    return res.ok;
  }
}

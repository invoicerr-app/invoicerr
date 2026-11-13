import type { Dispatcher } from 'undici';

import { postWebhookJson, WebhookDriver } from './webhook-driver.interface';

/** The raw payload as JSON, unsigned. */
export class ZapierDriver implements WebhookDriver {
  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const res = await postWebhookJson(url, JSON.stringify(payload), dispatcher);
    return res.ok;
  }
}

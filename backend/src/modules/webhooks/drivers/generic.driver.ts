import type { Dispatcher } from 'undici';

import { createHmac } from 'node:crypto';

import { postWebhookJson, WebhookDriver } from './webhook-driver.interface';

/** The raw payload as JSON, HMAC-SHA256-signed in `X-Webhook-Signature` when a secret is set. */
export class GenericDriver implements WebhookDriver {
  async send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = secret
      ? { 'X-Webhook-Signature': createHmac('sha256', secret).update(body).digest('hex') }
      : {};

    const res = await postWebhookJson(url, body, dispatcher, headers);
    return res.ok;
  }
}

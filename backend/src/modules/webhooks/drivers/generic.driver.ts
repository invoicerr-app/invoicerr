import type { Dispatcher } from 'undici';

import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';
import { WebhookType } from '../../../../prisma/generated/prisma/client';
import crypto from 'node:crypto';

export class GenericDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.GENERIC;
  }

  async send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const body = JSON.stringify(payload);

    const signature = secret ? crypto.createHmac('sha256', secret).update(body).digest('hex') : null;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Webhook-Signature': signature } : {}),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      // Pins the connection to the address `webhooks.service.ts#send` already validated — see
      // `webhook-driver.interface.ts`'s own header on why this must never be omitted.
      dispatcher,
    } as RequestInit);

    return res.ok;
  }
}

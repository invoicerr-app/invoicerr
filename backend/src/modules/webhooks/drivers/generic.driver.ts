import type { Dispatcher } from 'undici';

import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';
import { WebhookType } from '../../../../prisma/generated/prisma/client';
// Named import, not a default one: under `module: NodeNext`, ts-jest's transform drops the
// `__importDefault` interop helper and the default binding is `undefined` at test time, silently
// skipping the signature. Every `node:crypto` import here is named for that reason.
import { createHmac } from 'node:crypto';

export class GenericDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.GENERIC;
  }

  async send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const body = JSON.stringify(payload);

    const signature = secret ? createHmac('sha256', secret).update(body).digest('hex') : null;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Webhook-Signature': signature } : {}),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      // Pins the address validated by the guard; see webhook-driver.interface.ts.
      dispatcher,
    } as RequestInit);

    return res.ok;
  }
}

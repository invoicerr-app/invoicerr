import type { Dispatcher } from 'undici';

import { WEBHOOK_FETCH_TIMEOUT_MS, WebhookDriver } from './webhook-driver.interface';
import { WebhookType } from '../../../../prisma/generated/prisma/client';

export class ZapierDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.ZAPIER;
  }

  async send(url: string, payload: any, _secret?: string | null, dispatcher?: Dispatcher): Promise<boolean> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
      // See `webhook-driver.interface.ts`'s own header on why this must never be omitted.
      dispatcher,
    } as RequestInit);

    return res.ok;
  }
}

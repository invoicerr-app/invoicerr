import { WebhookType } from '../../../../prisma/generated/prisma/client';
import type { WebhookDriver } from './webhook-driver.interface';

export class ZapierDriver implements WebhookDriver {
  supports(type: WebhookType) {
    return type === WebhookType.ZAPIER;
  }

  async send(url: string, payload: any): Promise<boolean> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return res.ok;
  }
}

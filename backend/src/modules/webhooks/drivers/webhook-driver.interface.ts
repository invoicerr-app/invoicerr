import type { WebhookType } from '../../../../prisma/generated/prisma/client';

export interface WebhookDriver {
  supports(type: WebhookType): boolean;
  send(url: string, payload: any, secret?: string | null): Promise<boolean>;
}

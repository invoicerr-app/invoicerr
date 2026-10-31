import type { Dispatcher } from 'undici';

import { WebhookType } from '../../../../prisma/generated/prisma/client';

export interface WebhookDriver {
  supports(type: WebhookType): boolean;
  /**
   * `dispatcher`, when given, is `pinnedDispatcher` applied to the address `send` already validated:
   * every driver owning a `fetch()` must pass it as `{ dispatcher }`, or `fetch` resolves the hostname
   * again (the DNS-rebinding window). `undefined` means nothing to pin.
   */
  send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean>;
}

/**
 * Outbound-fetch hardening shared by the drivers: a validated endpoint can still answer with a 30x
 * pointing at an internal address, so redirects are never followed, and a bounded timeout keeps one
 * unresponsive endpoint from hanging the batch.
 */
export const WEBHOOK_FETCH_TIMEOUT_MS = 10_000;

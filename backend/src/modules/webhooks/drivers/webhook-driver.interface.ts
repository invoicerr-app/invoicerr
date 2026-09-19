import type { Dispatcher } from 'undici';

import { WebhookType } from '../../../../prisma/generated/prisma/client';

export interface WebhookDriver {
  supports(type: WebhookType): boolean;
  /**
   * `dispatcher`, when given, is `@/utils/outbound-url.ts#pinnedDispatcher` applied to the exact
   * address `webhooks.service.ts#send` already validated `url`'s hostname against — every driver that
   * owns a `fetch()` call MUST pass it through as `{ dispatcher }` rather than letting `fetch` resolve
   * the hostname again on its own (see `WEBHOOK_FETCH_TIMEOUT_MS`'s own header on why: a second,
   * independent resolution is exactly the DNS-rebinding window pinning exists to close). `undefined`
   * means "nothing to pin" (the `ALLOW_PRIVATE_WEBHOOK_URLS` test-only bypass) — connect normally.
   */
  send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean>;
}

/**
 * Outbound-fetch hardening shared by every driver that owns its own `fetch()` call — closes the SSRF
 * path URL validation alone cannot cover. The target URL is validated before the send is ever attempted
 * (`webhook-url-guard.ts`, re-run in `webhooks.service.ts#send` right before each dispatch), but a
 * malicious or compromised endpoint could otherwise answer with a 30x that redirects the *same*
 * request to an internal address and bypass that check entirely — so redirects are never followed
 * automatically. A bounded timeout keeps one unresponsive endpoint from hanging a whole dispatch.
 */
export const WEBHOOK_FETCH_TIMEOUT_MS = 10_000;

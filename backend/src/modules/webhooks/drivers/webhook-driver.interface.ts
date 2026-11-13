import type { Dispatcher } from 'undici';

export interface WebhookDriver {
  /**
   * `dispatcher`, when given, is `pinnedDispatcher` applied to the address `send` already validated;
   * `undefined` means nothing to pin. Drivers hand it to `postWebhookJson`, never to `fetch` directly.
   */
  send(url: string, payload: any, secret?: string | null, dispatcher?: Dispatcher): Promise<boolean>;
}

/**
 * Outbound-fetch hardening shared by the drivers: a validated endpoint can still answer with a 30x
 * pointing at an internal address, so redirects are never followed, and a bounded timeout keeps one
 * unresponsive endpoint from holding the delivery.
 */
export const WEBHOOK_FETCH_TIMEOUT_MS = 10_000;

/**
 * The only outbound request a driver makes. The pinned `dispatcher` connects to the address the guard
 * validated; without it `fetch` would resolve the hostname again (the DNS-rebinding window).
 */
export function postWebhookJson(
  url: string,
  body: string,
  dispatcher?: Dispatcher,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
    dispatcher,
  } as RequestInit);
}

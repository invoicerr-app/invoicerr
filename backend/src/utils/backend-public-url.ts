/**
 * The base URL a THIRD-PARTY SERVER — never a browser, never this app's own frontend — needs to reach
 * THIS backend at, to deliver a webhook: Mollie's `POST /v2/payments` `webhookUrl` field
 * (`payments/providers/mollie/mollie-provider.ts#webhookUrlFor`), and the inbound plugin webhook URL
 * this app hands out for `POST /api/webhooks/:uuid` (`webhooks/webhooks.service.ts#generateWebhookUrl`,
 * `plugins/plugins.service.ts#pluginValidation`).
 *
 * `APP_URL` cannot serve this alone: it is ALSO the frontend's own origin (every browser-redirect URL
 * in this codebase — `client-portal/portal.service.ts`'s checkout return URLs, `client-portal/
 * portal-tokens.service.ts`'s emailed invite link, `documents/signatures/signatures.service.ts`'s
 * signature-request link, `billing/portal-return-url.ts`'s Polar return URL) and better-auth's own
 * `baseURL`/`trustedOrigins` (`lib/auth.ts`) — so it must stay whatever origin the operator's BROWSER
 * actually uses (`http://localhost:5173` in dev, the real public domain in production). A developer
 * testing a webhook-driven integration locally (no public domain yet) typically runs the frontend
 * un-tunnelled (the browser is already local, it needs no tunnel) while exposing ONLY the backend
 * through something like `cloudflared`/`ngrok` — pointing `APP_URL` itself at that tunnel would break
 * every browser-facing link and CORS/better-auth origin check above for zero benefit, since none of
 * those are ever called by a third party.
 *
 * `BACKEND_PUBLIC_URL` is the escape hatch: optional, falling back to `APP_URL` (so every deployment
 * that never needs the distinction — the overwhelming majority, where the backend and frontend already
 * share one public origin behind nginx, see CLAUDE.md's own "Deployment topology" — needs to set
 * nothing new at all), and read ONLY by the handful of call sites above that build a URL a third-party
 * SERVER, not a browser, is expected to call back into.
 */
export function backendPublicUrl(): string {
  const url = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}

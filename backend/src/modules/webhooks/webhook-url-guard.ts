import {
  OutboundUrlPolicy,
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundUrl,
} from '@/utils/outbound-url';

export { ResolvedOutboundUrl };

export { OutboundUrlValidationError as WebhookUrlValidationError };

/**
 * SSRF guard for outbound webhook URLs — high severity: left unguarded, this is a direct path to an
 * authenticated SSRF primitive against this server's own infrastructure (see below).
 *
 * A webhook `url` is set by an OWNER/ADMIN of a tenant (or a compromised account, or — in a
 * multi-tenant SaaS deployment — another tenant entirely), yet the HTTP request it triggers is
 * emitted by the invoicerr server itself, from the server's own network. Without this guard, a
 * webhook pointed at `http://169.254.169.254/...` (cloud instance metadata) or
 * `http://some-internal-service:port/` turns every webhook-firing event into an authenticated SSRF
 * primitive against invoicerr's own infrastructure.
 *
 * The actual decision logic (scheme/port/private-IP/DNS-rebinding) now lives in
 * `@/utils/outbound-url.ts#assertPublicOutboundUrl`, shared with the company-SSO and PDP/SdI
 * transport guards added since — this file is the thin, webhook-specific POLICY on top of it: both
 * `http:` and `https:` (a receiver on plain HTTP is a normal, if dated, webhook target — unlike an
 * IdP or a national e-invoicing platform), and no port restriction (a receiver on a non-standard port
 * is normal). `WebhookUrlValidationError`/`assertPublicWebhookUrl` keep their original names so every
 * existing caller (`webhooks.service.ts`) and this file's own long-standing spec need no changes.
 *
 * `assertPublicWebhookUrl` is called from two places, deliberately:
 *  - `webhooks.service.ts` create/update — reject bad input before it is ever persisted.
 *  - `webhooks.service.ts#send` — re-run right before *every* dispatch. DNS is not a fact fixed at
 *    creation time: a hostname that resolved to a public IP when the webhook was created can be
 *    repointed at a private one by the time an event actually fires ("DNS rebinding"). Re-resolving
 *    on every send closes that window; validating once at rest does not.
 *
 * This function does not itself decide HTTP status codes or log anything — it throws
 * `WebhookUrlValidationError` with an internal `reason` string. Callers must NOT surface `reason` or
 * the raw URL back to the client or into logs verbatim: doing so turns the validator into a scanning
 * oracle ("is 10.0.3.4 open? is 169.254.x.y blocked? what about 172.20.0.1?").
 *
 * On success it returns the `ResolvedOutboundUrl` that was actually checked (or `null` under the
 * escape hatch below) — callers MUST connect through `@/utils/outbound-url.ts#pinnedDispatcher` on
 * THIS value rather than letting `fetch` resolve the hostname a second, independent time. Discarding
 * it (as this file used to) leaves the exact DNS-rebinding window the re-validation-on-every-send
 * discipline above was meant to close: a public answer here does not stop a short-TTL record from
 * answering differently the moment the real socket connects, a few milliseconds later.
 */
const WEBHOOK_URL_POLICY: OutboundUrlPolicy = {
  allowedProtocols: ['http:', 'https:'],
  allowedPorts: null,
};

/**
 * Dev/test-only escape hatch — NEVER set in production. The scheme check in
 * `assertPublicOutboundUrl` STILL runs (file:, gopher:… stay rejected); only the private/loopback/
 * link-local blocking is skipped, so the e2e webhook-delivery suite (42-webhooks) can point a webhook
 * at its own in-process localhost receiver. `start:test` sets it via .env.test; jest does not load
 * .env.test, and production must never define it — doing so would silently reopen the exact SSRF
 * path this guard exists to close.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<ResolvedOutboundUrl | null> {
  return assertPublicOutboundUrl(rawUrl, {
    ...WEBHOOK_URL_POLICY,
    allowPrivateForTesting: process.env.ALLOW_PRIVATE_WEBHOOK_URLS === '1',
  });
}

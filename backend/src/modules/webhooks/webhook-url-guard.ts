import {
  OutboundUrlPolicy,
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundUrl,
} from '@/utils/outbound-url';

export { ResolvedOutboundUrl };

export { OutboundUrlValidationError as WebhookUrlValidationError };

/**
 * SSRF guard for outbound webhook URLs: the URL is tenant-supplied but the request leaves this
 * server's network, so it must resolve to a public address. Webhooks allow plain HTTP and any port,
 * unlike the stricter policies of the shared guard in `@/utils/outbound-url`.
 *
 * Returns the address that was checked; callers must connect through `pinnedDispatcher` on it, or
 * `fetch` resolves the hostname again and reopens the DNS-rebinding window. Never surface the `reason`
 * or the raw URL to a client or a log: that turns this into a scanning oracle.
 */
const WEBHOOK_URL_POLICY: OutboundUrlPolicy = {
  allowedProtocols: ['http:', 'https:'],
  allowedPorts: null,
};

/**
 * Dev/test only, never set in production: the scheme check still runs, only the private-range block
 * is lifted so the e2e suite can point a webhook at a localhost receiver.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<ResolvedOutboundUrl | null> {
  return assertPublicOutboundUrl(rawUrl, {
    ...WEBHOOK_URL_POLICY,
    allowPrivateForTesting: process.env.ALLOW_PRIVATE_WEBHOOK_URLS === '1',
  });
}

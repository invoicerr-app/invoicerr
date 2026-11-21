import {
  allowPrivateOutboundForTesting,
  assertPublicOutboundUrl,
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
} from '@/utils/outbound-url';

/**
 * The outbound-URL check the provider API clients whose base URL comes from a tenant's channel
 * configuration (SuperPDP, Invopop, Billit) run before every call: both schemes, no port restriction
 * (see `superpdp/superpdp-client.ts`'s header on why this differs from the https-only/port-443 policy
 * `sso.service.ts` applies to a company's OIDC endpoints). `sdi/sdicoop-client.ts` keeps its own call:
 * its options differ.
 *
 * A validation failure is rethrown as the error `rejection` builds, whose message each client keeps
 * deliberately generic: the transport folds it into a user-facing error, and naming the reason would
 * turn this guard into a network-scanning oracle. Any other error propagates unchanged.
 *
 * Returns the `ResolvedOutboundUrl` just proved public: the caller MUST connect through
 * `pinnedDispatcher(resolved)` rather than letting `fetch` resolve the hostname a second time.
 */
export async function resolvePublicProviderBaseUrl(
  baseUrl: string,
  rejection: () => Error,
): Promise<ResolvedOutboundUrl | null> {
  try {
    return await assertPublicOutboundUrl(baseUrl, {
      allowedProtocols: ['http:', 'https:'],
      allowedPorts: null,
      allowPrivateForTesting: allowPrivateOutboundForTesting(),
    });
  } catch (err) {
    if (err instanceof OutboundUrlValidationError) throw rejection();
    throw err;
  }
}

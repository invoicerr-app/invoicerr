import type { KsefCredentials } from '../ksef-transport';
import { FetchKsefHttpClient } from './fetch-http-client';
import { KsefClient } from './ksef-client';
import { loadVendorizedKeys } from './ksef-public-keys';

/**
 * The one way this codebase builds a `KsefClient` for a company's credentials: the vendored public
 * keys of the credentials' environment, over the plain `fetch` HTTP client. Shared by the transport
 * (`ksef-transport.ts#send`) and the status poller (`ksef-status-poller.ts`), which used to write the
 * same construction each on their own, the way Chorus Pro shares `buildChorusProClient`.
 *
 * Its own file rather than an export of `ksef-client.ts`: the transport and poller specs replace
 * `KsefClient` by mocking that whole module, and a builder living inside it would be mocked away with
 * it. From here, `new KsefClient(...)` reaches whatever the spec put in its place.
 */
export function buildKsefClient(credentials: KsefCredentials): KsefClient {
  const keys = loadVendorizedKeys(credentials.environment);
  const http = new FetchKsefHttpClient();
  return new KsefClient(http, {
    environment: credentials.environment,
    nip: credentials.nip,
    ksefToken: credentials.ksefToken,
    tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
    symmetricKeyPem: keys.symmetricKeyPem,
  });
}

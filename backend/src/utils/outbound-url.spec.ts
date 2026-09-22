/**
 * `assertPublicOutboundUrl` — the shared decision function `webhook-url-guard.ts` (webhooks),
 * `sso.service.ts`/`sso-registrar.service.ts` (company OIDC endpoints) and `pdp-client.ts`/
 * `sdicoop-client.ts` (national e-invoicing transports) all delegate to. `webhook-url-guard.spec.ts`
 * already covers the private/loopback/link-local/DNS logic exhaustively through the webhook policy
 * (both schemes, no port restriction); this file instead proves the two knobs that policy never
 * exercises — the https-only default and the port restriction — plus enough of the shared logic
 * (one literal IP, one DNS case, the escape hatch) to prove this module is correct on its OWN, since
 * every non-webhook caller depends on it directly rather than through that wrapper.
 *
 * `describe('pinning ...')` below is the load-bearing one: `assertPublicOutboundUrl` on its own only
 * proves the hostname resolved PUBLIC at the moment it was checked — a real `fetch()`/`https.request()`
 * call made straight afterward still does its OWN, entirely independent DNS resolution, which a
 * short-TTL record can answer differently by then ("DNS rebinding"/TOCTOU). `pinnedDispatcher`/
 * `pinnedNodeLookup` are what actually close that window, and this is the one thing worth proving
 * against a REAL socket, not a mock of the connect step itself.
 */

import { vi, type Mock } from 'vitest';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import * as dns from 'node:dns';

import {
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundHost,
  assertPublicOutboundUrl,
  pinnedDispatcher,
  pinnedNodeLookup,
} from './outbound-url';

// `outbound-url.ts` imports `node:dns` as a namespace (`import * as dns`, not a default import — see
// that file's own comment on why), so the mock must match that shape exactly.
vi.mock('node:dns', () => ({ promises: { lookup: vi.fn() } }));

const lookup = dns.promises.lookup as unknown as Mock;

describe('assertPublicOutboundUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('scheme — default policy is https-only', () => {
    it('rejects plain http with no policy override', async () => {
      await expect(assertPublicOutboundUrl('http://example.com/')).rejects.toThrow(
        OutboundUrlValidationError,
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('accepts https on the default policy and returns what to pin to', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicOutboundUrl('https://idp.example.com/')).resolves.toMatchObject({
        hostname: 'idp.example.com',
        address: '203.0.113.10',
        family: 4,
      });
    });

    it('an explicit allowedProtocols list widens (or narrows) the default', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(
        assertPublicOutboundUrl('http://example.com/', { allowedProtocols: ['http:', 'https:'] }),
      ).resolves.not.toBeNull();
    });
  });

  describe('port — default policy allows only the scheme default port (443 for https)', () => {
    it('accepts https with no explicit port (defaults to 443)', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicOutboundUrl('https://idp.example.com/token')).resolves.not.toBeNull();
    });

    it('accepts https explicitly on :443', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicOutboundUrl('https://idp.example.com:443/token')).resolves.not.toBeNull();
    });

    it('rejects a non-standard port under the default policy', async () => {
      await expect(assertPublicOutboundUrl('https://idp.example.com:8443/token')).rejects.toThrow(
        OutboundUrlValidationError,
      );
      // Rejected on the port check, before ever resolving the hostname.
      expect(lookup).not.toHaveBeenCalled();
    });

    it('an explicit allowedPorts list overrides the default', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(
        assertPublicOutboundUrl('https://idp.example.com:8443/token', { allowedPorts: [443, 8443] }),
      ).resolves.not.toBeNull();
    });

    it('allowedPorts: null disables the port check entirely (the webhook policy)', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(
        assertPublicOutboundUrl('https://idp.example.com:9999/token', { allowedPorts: null }),
      ).resolves.not.toBeNull();
    });
  });

  describe('blockedHostnames — additive on top of the built-in list', () => {
    it('rejects a caller-supplied hostname even though it is not one of the built-in blocked names', async () => {
      await expect(
        assertPublicOutboundUrl('https://internal-idp.corp/', { blockedHostnames: ['internal-idp.corp'] }),
      ).rejects.toThrow(OutboundUrlValidationError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('still rejects the built-in names when a caller policy adds its own', async () => {
      await expect(
        assertPublicOutboundUrl('https://localhost/', { blockedHostnames: ['internal-idp.corp'] }),
      ).rejects.toThrow(OutboundUrlValidationError);
    });
  });

  describe('shared private-IP / DNS logic — smoke coverage (exhaustive cases live in webhook-url-guard.spec.ts)', () => {
    it('rejects a literal private IPv4 address without a DNS round-trip', async () => {
      await expect(assertPublicOutboundUrl('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        OutboundUrlValidationError,
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('a literal public IP still returns itself as the pin (no DNS involved)', async () => {
      await expect(assertPublicOutboundUrl('https://8.8.8.8/')).resolves.toEqual({
        hostname: '8.8.8.8',
        address: '8.8.8.8',
        family: 4,
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a hostname whose DNS answer is private ("DNS rebinding" defense)', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      await expect(assertPublicOutboundUrl('https://internal.example.com/')).rejects.toThrow(
        OutboundUrlValidationError,
      );
    });

    it('accepts a hostname whose only resolved address is public', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicOutboundUrl('https://public.example.com/')).resolves.toMatchObject({
        hostname: 'public.example.com',
        address: '203.0.113.10',
      });
      expect(lookup).toHaveBeenCalledWith('public.example.com', { all: true });
    });
  });

  describe('allowPrivateForTesting — caller-computed escape hatch', () => {
    it('skips the port and private-IP checks when true, returning null (nothing was resolved to pin)', async () => {
      await expect(
        assertPublicOutboundUrl('https://127.0.0.1:1/hook', { allowPrivateForTesting: true }),
      ).resolves.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('never skips the scheme check, even when true', async () => {
      await expect(
        assertPublicOutboundUrl('file:///etc/passwd', { allowPrivateForTesting: true }),
      ).rejects.toThrow(OutboundUrlValidationError);
    });
  });
});

/**
 * The host+port entry point, for endpoints that are not spelled as a URL — a company's own SMTP
 * server, the SdI PEC mailbox. It shares `assertPublicHostname` with `assertPublicOutboundUrl` above,
 * so only what is NOT shared is worth proving here: the parsing of a bare host field, the port range,
 * and that the shared decision really is reached through it. What that guard buys the mail path (and
 * what a refusal is allowed to SAY) is `modules/company/mail-settings/company-mail-settings.ssrf.spec.ts`.
 */
describe('assertPublicOutboundHost — a bare host and port, not a URL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a public host on any port — an SMTP relay is not restricted to one', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.20', family: 4 }]);
    await expect(assertPublicOutboundHost('smtp.customer.example', 2525)).resolves.toMatchObject({
      hostname: 'smtp.customer.example',
      address: '203.0.113.20',
      family: 4,
    });
  });

  it.each([
    ['literal loopback', '127.0.0.1'],
    ['RFC1918', '10.0.0.5'],
    ['cloud instance metadata', '169.254.169.254'],
    ['IPv6 loopback, unbracketed as a settings field would carry it', '::1'],
    ['IPv6 loopback, bracketed', '[::1]'],
    ['the name "localhost"', 'localhost'],
  ])('refuses %s without resolving anything', async (_label, host) => {
    await expect(assertPublicOutboundHost(host, 25)).rejects.toThrow(OutboundUrlValidationError);
  });

  it('folds a legacy integer IPv4 spelling to its dotted quad before deciding', async () => {
    // `getaddrinfo` accepts `2130706433` as 127.0.0.1, so a guard that treated it as an opaque name
    // would hand it straight to a resolver that turns it into loopback at connect time.
    await expect(assertPublicOutboundHost('2130706433', 6379)).rejects.toThrow(
      'literal address is private/internal',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a host field carrying anything other than a host', async () => {
    // Each of these would otherwise reach a different target than the port this guard was told about.
    for (const host of ['smtp.example.com/../x', 'user@smtp.example.com', 'smtp.example.com:25', '']) {
      await expect(assertPublicOutboundHost(host, 25)).rejects.toThrow('malformed host');
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a port outside 1-65535, and a non-integer one', async () => {
    for (const port of [0, -1, 70000, 25.5, Number.NaN]) {
      await expect(assertPublicOutboundHost('smtp.customer.example', port)).rejects.toThrow('invalid port');
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a public NAME that resolves into a private range', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }]);
    await expect(assertPublicOutboundHost('mail.attacker.example', 587)).rejects.toThrow(
      'hostname resolves to a private/internal address',
    );
  });

  it('still refuses a malformed host under the escape hatch, but waives the address checks', async () => {
    await expect(
      assertPublicOutboundHost('localhost', 1025, { allowPrivateForTesting: true }),
    ).resolves.toBeNull();
    await expect(
      assertPublicOutboundHost('smtp.example.com:25', 25, { allowPrivateForTesting: true }),
    ).rejects.toThrow('malformed host');
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('pinning — closes the TOCTOU/DNS-rebinding gap between validation and connection', () => {
  beforeEach(() => vi.clearAllMocks());

  // `resolved` is built BY HAND, not through `assertPublicOutboundUrl`, in these two tests: the local
  // stand-in server can only ever bind to a loopback address, which the real validation pipeline
  // (correctly) always rejects — see `webhook-url-guard.spec.ts`'s own exhaustive coverage of that.
  // What these two tests are about is a DIFFERENT question — given a value `assertPublicOutboundUrl`
  // already vouched for, does the actual connection honour it — so they start from that value
  // directly, exactly as every real caller (webhooks, PDP, SdI) receives it.

  it('fetch() with pinnedDispatcher connects to the validated address, never a later (rebound) DNS answer', async () => {
    // A real local server standing in for the legitimate target `rebind-target.example` validated to.
    const server = http.createServer((_req, res) => res.end('legit-server'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const resolved: ResolvedOutboundUrl = {
        hostname: 'rebind-target.example',
        address: '127.0.0.1',
        family: 4,
      };

      // Queued for the lookup a NON-pinned `fetch` would trigger on its own — simulating a short-TTL
      // record having been repointed at a private address in the meantime. If pinning did not work,
      // connecting to `rebind-target.example` now would follow THIS answer instead.
      lookup.mockResolvedValueOnce([{ address: '10.0.0.99', family: 4 }]);

      const res = await fetch(`http://rebind-target.example:${port}/`, {
        dispatcher: pinnedDispatcher(resolved),
      } as RequestInit);
      const body = await res.text();

      // Reached the address that was actually validated — never the "rebound" one.
      expect(body).toBe('legit-server');
      // THE structural proof, not just a lucky outcome: the connect step never consulted DNS at all.
      // `pinnedLookup` answers synthetically from the already-validated address; the mocked answer
      // above was never even asked for.
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('http.request() with pinnedNodeLookup exhibits the identical property (the SdI/https.request path)', async () => {
    const server = http.createServer((_req, res) => res.end('legit-server-native'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const resolved: ResolvedOutboundUrl = {
        hostname: 'native-rebind-target.example',
        address: '127.0.0.1',
        family: 4,
      };
      lookup.mockResolvedValueOnce([{ address: '10.0.0.99', family: 4 }]); // never consulted

      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'native-rebind-target.example',
            port,
            path: '/',
            method: 'GET',
            lookup: pinnedNodeLookup(resolved),
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
        req.end();
      });

      expect(body).toBe('legit-server-native');
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('pinnedDispatcher/pinnedNodeLookup return undefined for the allowPrivateForTesting (null) case — connect normally', () => {
    expect(pinnedDispatcher(null)).toBeUndefined();
    expect(pinnedNodeLookup(null)).toBeUndefined();
  });
});

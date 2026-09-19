/**
 * SSRF via an outbound webhook URL — the guard's own decision logic. `webhooks.service.spec.ts`
 * proves the guard is actually CALLED at create/update/send; this file proves what it decides: scheme
 * filtering, every private/loopback/link-local IP range a webhook target must not resolve to, and
 * real DNS resolution (mocked at `node:dns`) including the "reject if ANY resolved address is
 * private" and "re-resolve on every call" properties the anti-rebinding defense relies on.
 *
 * Removing the guard (or gutting any one of its checks) must turn one of these tests red — that is
 * the point of testing a security control this way rather than only asserting the happy path.
 */

import { vi, type Mock } from 'vitest';

import * as dns from 'node:dns';

import { WebhookUrlValidationError, assertPublicWebhookUrl } from './webhook-url-guard';

// `webhook-url-guard.ts` imports `node:dns` as a namespace (`import * as dns`, not a default import —
// see that file's own comment on why), so the mock must match that shape exactly: no `__esModule`/
// `default` wrapper, or the guard's `dns.promises.lookup` call would see `undefined` and never reach
// this mock at all.
vi.mock('node:dns', () => ({ promises: { lookup: vi.fn() } }));

const lookup = dns.promises.lookup as unknown as Mock;

describe('assertPublicWebhookUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('scheme validation', () => {
    it('rejects file:// (local filesystem, not a network fetch at all)', async () => {
      await expect(assertPublicWebhookUrl('file:///etc/passwd')).rejects.toThrow(WebhookUrlValidationError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each([
      'gopher://example.com/',
      'ftp://example.com/',
      'data:text/plain;base64,aGk=',
    ])('rejects non-http(s) scheme: %s', async (url) => {
      await expect(assertPublicWebhookUrl(url)).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects a string that is not a URL at all, without throwing an uncaught error', async () => {
      await expect(assertPublicWebhookUrl('not a url')).rejects.toThrow(WebhookUrlValidationError);
    });

    it('accepts https', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicWebhookUrl('https://hooks.example.com/endpoint')).resolves.not.toBeNull();
    });

    it('accepts plain http (the finding is about internal targets, not transport encryption)', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicWebhookUrl('http://hooks.example.com/endpoint')).resolves.not.toBeNull();
    });
  });

  describe('blocked literal hostnames — rejected before any DNS lookup', () => {
    it('rejects http://localhost', async () => {
      await expect(assertPublicWebhookUrl('http://localhost:3000/hook')).rejects.toThrow(
        WebhookUrlValidationError,
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects the GCP metadata hostname', async () => {
      await expect(
        assertPublicWebhookUrl('http://metadata.google.internal/computeMetadata/v1/'),
      ).rejects.toThrow(WebhookUrlValidationError);
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('literal IP addresses — rejected without ever calling DNS', () => {
    it.each([
      ['cloud metadata link-local', 'http://169.254.169.254/latest/meta-data/'],
      ['loopback', 'http://127.0.0.1/hook'],
      ['loopback shorthand', 'http://127.1/hook'],
      ['RFC1918 10/8', 'http://10.0.0.5/hook'],
      ['RFC1918 192.168/16', 'http://192.168.1.1/hook'],
      ['RFC1918 172.16/12', 'http://172.20.3.4/hook'],
      ['"this network" 0.0.0.0/8', 'http://0.0.0.0/hook'],
      ['obfuscated hex-encoded loopback', 'http://0x7f000001/hook'],
      ['obfuscated decimal loopback', 'http://2130706433/hook'],
      ['obfuscated octal loopback', 'http://0177.0.0.1/hook'],
      ['IPv6 loopback', 'http://[::1]/hook'],
      ['IPv6 unspecified', 'http://[::]/hook'],
      ['IPv6 link-local', 'http://[fe80::1]/hook'],
      ['IPv6 unique-local (ULA)', 'http://[fd12:3456:789a::1]/hook'],
      ['IPv4-mapped IPv6 metadata (dotted form)', 'http://[::ffff:169.254.169.254]/hook'],
      ['IPv4-mapped IPv6 loopback (hex-group form)', 'http://[::ffff:7f00:1]/hook'],
    ])('rejects %s', async (_label, url) => {
      await expect(assertPublicWebhookUrl(url)).rejects.toThrow(WebhookUrlValidationError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('accepts a public literal IPv4 address', async () => {
      await expect(assertPublicWebhookUrl('https://8.8.8.8/hook')).resolves.not.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('accepts a public literal IPv6 address', async () => {
      await expect(assertPublicWebhookUrl('https://[2001:4860:4860::8888]/hook')).resolves.not.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('DNS resolution', () => {
    it('accepts a hostname whose only resolved address is public', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicWebhookUrl('https://hooks.example.com/endpoint')).resolves.not.toBeNull();
      expect(lookup).toHaveBeenCalledWith('hooks.example.com', { all: true });
    });

    it('rejects a hostname that resolves to a private address', async () => {
      lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      await expect(assertPublicWebhookUrl('https://internal.example.com/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );
    });

    it('rejects a hostname that resolves to a private IPv6 address', async () => {
      lookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }]);
      await expect(assertPublicWebhookUrl('https://ula.example.com/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );
    });

    it('rejects when ANY resolved answer is private, not only the first one', async () => {
      lookup.mockResolvedValue([
        { address: '203.0.113.10', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]);
      await expect(assertPublicWebhookUrl('https://mixed.example.com/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );
    });

    it('rejects cleanly — not a crash — when the hostname does not resolve at all', async () => {
      lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
      await expect(assertPublicWebhookUrl('https://does-not-exist.invalid/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );
    });

    it('rejects cleanly when DNS resolves to an empty answer set', async () => {
      lookup.mockResolvedValue([]);
      await expect(assertPublicWebhookUrl('https://empty.example.com/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );
    });

    it('re-resolves on every call — the property DNS-rebinding defense at send time depends on', async () => {
      lookup.mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertPublicWebhookUrl('https://rebind.example.com/endpoint')).resolves.not.toBeNull();

      lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
      await expect(assertPublicWebhookUrl('https://rebind.example.com/endpoint')).rejects.toThrow(
        WebhookUrlValidationError,
      );

      expect(lookup).toHaveBeenCalledTimes(2);
    });
  });
});

describe('assertPublicWebhookUrl — ALLOW_PRIVATE_WEBHOOK_URLS escape hatch (dev/test only)', () => {
  const original = process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    else process.env.ALLOW_PRIVATE_WEBHOOK_URLS = original;
  });

  it('with the flag set, a localhost/private URL is allowed (so 42-webhooks can use its local receiver) — nothing to pin, so null', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
    await expect(assertPublicWebhookUrl('http://localhost:9099/hook')).resolves.toBeNull();
    await expect(assertPublicWebhookUrl('http://127.0.0.1:9099/hook')).resolves.toBeNull();
  });

  it('the flag NEVER relaxes the scheme check — file: is still rejected even when set', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
    await expect(assertPublicWebhookUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
      WebhookUrlValidationError,
    );
  });

  it('without the flag, a private URL is rejected — the guard is on by default (jest never loads .env.test)', async () => {
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    await expect(assertPublicWebhookUrl('http://127.0.0.1:9099/hook')).rejects.toBeInstanceOf(
      WebhookUrlValidationError,
    );
  });
});

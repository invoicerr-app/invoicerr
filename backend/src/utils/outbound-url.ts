// Namespace imports, not default imports: `import net from 'node:net'` compiles cleanly under
// `nest build` (which emits the `__importDefault` interop helper) but resolves to `undefined` under
// this project's ts-jest config (no `esModuleInterop`, and ts-jest does not add the helper on its
// own) — every jest test in this file would otherwise crash on `net.isIP is not a function`. `import
// * as net` sidesteps the interop helper entirely and behaves identically under both compilers.
import * as dns from 'node:dns';
import * as net from 'node:net';

import { Agent } from 'undici';

/**
 * Shared SSRF guard for every outbound URL this backend is handed by a TENANT and later dials itself
 * — a webhook receiver, a company's own OIDC endpoints, a PDP/SdI transport's `baseUrl`/`endpoint`.
 * Originally lived only as `modules/webhooks/webhook-url-guard.ts#assertPublicWebhookUrl`; pulled out
 * here once a SECOND caller (company SSO) needed the exact same private/loopback/link-local logic —
 * see that file's own header, now a thin wrapper around `assertPublicOutboundUrl` below with the
 * webhook-specific policy (both http/https, no port restriction) so its own tests and callers keep
 * working unchanged.
 *
 * Each caller supplies its OWN policy rather than this module reading a caller-specific env var
 * itself: `allowPrivateForTesting` is computed by the CALLER from whichever escape hatch it already
 * documents (`ALLOW_PRIVATE_WEBHOOK_URLS` for webhooks, `ALLOW_PRIVATE_OUTBOUND_URLS` for everything
 * else added since — see `.env.example`), so this file stays a pure decision function with no
 * knowledge of which feature is calling it.
 */
export class OutboundUrlValidationError extends Error {
  constructor(public readonly reason: string) {
    super(`outbound URL rejected: ${reason}`);
    this.name = 'OutboundUrlValidationError';
  }
}

/**
 * What `assertPublicOutboundUrl` actually checked, handed back so a caller can pin its real
 * connection to it — see that function's own header on why discarding this (as every caller did
 * before) leaves a TOCTOU/DNS-rebinding window open: `fetch`/`https.request` do their OWN, entirely
 * independent hostname resolution moments later, which a short-TTL DNS answer can flip to a private
 * address in between. `null` means "nothing to pin" — either a literal IP was already the connection
 * target with no lookup involved, or `allowPrivateForTesting` skipped resolution entirely (a caller
 * seeing `null` back from a non-bypassed policy is a bug, never a valid state to connect on).
 */
export interface ResolvedOutboundUrl {
  /** The URL's own hostname, untouched — TLS SNI and any `Host` header must keep using THIS, never
   *  `address`, or a name-based vhost / certificate on the legitimate target would stop matching.
   *  `pinnedLookup`/`pinnedDispatcher` below never touch this on their own; both `fetch` (via undici's
   *  connector) and `https.request` already derive SNI/Host from the request's own URL/`hostname`
   *  option regardless of what a custom `lookup` resolves it to. */
  hostname: string;
  /** The exact address this hostname was validated against. Connect the real socket to THIS. */
  address: string;
  family: 4 | 6;
}

/**
 * A `dns.lookup`-shaped function that ALWAYS answers with the one address already validated —
 * ignoring whatever hostname it is actually asked to resolve, since by construction it is only ever
 * installed on a connection already scoped to that one hostname (`pinnedDispatcher`'s own `Agent`, or
 * a single `https.request` call). Handles both calling conventions Node's own connect machinery uses
 * (measured directly against this project's own Node/undici versions, not merely inferred from docs):
 * `{ all: true }` (Happy Eyeballs, the default in current Node `net.connect`/undici) wants an ARRAY of
 * `{address, family}`; the legacy path wants the plain `(err, address, family)` triple. Getting this
 * wrong doesn't merely fall back to real DNS (which would silently reopen the rebinding window) — it
 * throws `ERR_INVALID_IP_ADDRESS` instead, which is the safer failure direction and exactly what
 * surfaced while building this against Node 24's bundled undici.
 */
type NodeStyleLookupCallback =
  | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void)
  | ((err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void);

function pinnedLookup(
  resolved: ResolvedOutboundUrl,
): (
  hostname: string,
  options: dns.LookupOneOptions | { all?: boolean },
  callback: NodeStyleLookupCallback,
) => void {
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && 'all' in options && options.all) {
      (callback as (err: null, addresses: dns.LookupAddress[]) => void)(null, [
        { address: resolved.address, family: resolved.family },
      ]);
      return;
    }
    (callback as (err: null, address: string, family: number) => void)(
      null,
      resolved.address,
      resolved.family,
    );
  };
}

/**
 * The `fetch()`-side half of the pin: an undici `Agent` whose `connect.lookup` is `pinnedLookup`
 * above. Pass as `{ dispatcher: pinnedDispatcher(resolved) }` to every `fetch()` call made against the
 * SAME `resolved.hostname` — never reused across a different host. `undefined` in, `undefined` out:
 * the `allowPrivateForTesting` bypass path (no `ResolvedOutboundUrl` to pin to) means "connect however
 * `fetch` normally would," not "refuse to connect."
 */
export function pinnedDispatcher(resolved: ResolvedOutboundUrl | null): Agent | undefined {
  if (!resolved) return undefined;
  return new Agent({ connect: { lookup: pinnedLookup(resolved) } });
}

/**
 * The `https.request()`/`http.request()`-side half of the pin — both accept a `lookup` option with
 * the exact same shape `net.connect` does, no undici/Agent involved. Pass as `{ lookup:
 * pinnedNodeLookup(resolved) }`. Same `null`-in/`undefined`-out contract as `pinnedDispatcher`.
 */
export function pinnedNodeLookup(
  resolved: ResolvedOutboundUrl | null,
): ReturnType<typeof pinnedLookup> | undefined {
  return resolved ? pinnedLookup(resolved) : undefined;
}

export interface OutboundUrlPolicy {
  /** Schemes allowed. Default: `['https:']` — every NEW caller (SSO, PDP, SdI) is https-only; the
   *  webhook guard is the one exception, passing `['http:', 'https:']` for backward compatibility. */
  allowedProtocols?: string[];
  /**
   * Ports allowed, once the URL's own explicit port (or the scheme's default when none is written) is
   * known. Default: the scheme's own default port only (443 for https, 80 for http) — this is what
   * "https obligatoire, port 443 seulement" means in practice. Pass `null` to allow any port, which is
   * the webhook guard's own historical behavior (a receiver on a non-standard port is normal).
   */
  allowedPorts?: number[] | null;
  /** Hostnames to always reject, on top of the built-in metadata/loopback names below. */
  blockedHostnames?: string[];
  /**
   * Set true ONLY from a caller's own env-gated escape hatch, already resolved by the caller (never
   * read from the environment in here — see this file's own header). Skips every check below the
   * scheme check: private/loopback/link-local ranges, the port restriction, and DNS resolution. NEVER
   * true in production; every caller's own env var doc says so.
   */
  allowPrivateForTesting?: boolean;
}

const DEFAULT_PORT_FOR_SCHEME: Record<string, number> = { 'https:': 443, 'http:': 80 };

// Hostnames that must never be dialed regardless of what they resolve to (or even if they fail to
// resolve via the public DNS path at all — e.g. metadata.google.internal is only reachable from
// inside GCP, but a self-hosted instance running there would resolve it).
const ALWAYS_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal', // GCP instance metadata
  'metadata', // short form also used by GCP's resolver
]);

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  // Anything that doesn't parse as 4 clean octets is never "known safe" — fail closed.
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local — covers cloud metadata IPs
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 carrier-grade NAT — extra safety net
  return false;
}

/**
 * Expands any valid textual IPv6 address (including "::" compression and a trailing embedded IPv4,
 * e.g. "::ffff:1.2.3.4" or "64:ff9b::1.2.3.4") into its 128-bit value, so ranges can be checked by
 * integer comparison instead of fragile string prefix matching against every possible spelling.
 * Returns null for anything that doesn't parse.
 */
function expandIpv6(address: string): bigint | null {
  const zoneIdx = address.indexOf('%');
  const addr = zoneIdx === -1 ? address : address.slice(0, zoneIdx);
  if (!net.isIPv6(addr)) return null;

  // An embedded IPv4 tail (only ever legal at the very end of the address) is converted to two hex
  // groups and folded into the "right-hand side" groups below.
  const ipv4Match = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let head = addr;
  let ipv4Groups: string[] = [];
  if (ipv4Match) {
    const octets = ipv4Match[1].split('.').map(Number);
    if (octets.some((n) => n > 255)) return null;
    ipv4Groups = [((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
    head = addr.slice(0, addr.length - ipv4Match[1].length);
    // Only strip a lone separating ':' — a trailing "::" is the compression marker itself and must
    // survive so the split below still finds it.
    if (!head.endsWith('::') && head.endsWith(':')) head = head.slice(0, -1);
  }

  const halves = head.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const rightAll = [...right, ...ipv4Groups];

  const missing = 8 - left.length - rightAll.length;
  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null; // no "::" present -> must be exactly 8 groups

  const groups = [...left, ...Array(missing).fill('0'), ...rightAll];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    const n = Number.parseInt(group || '0', 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    value = (value << 16n) | BigInt(n);
  }
  return value;
}

function ipv6PrefixMatches(value: bigint, prefixAddress: string, prefixLength: number): boolean {
  const base = expandIpv6(prefixAddress);
  if (base === null) return false;
  const shift = BigInt(128 - prefixLength);
  return value >> shift === base >> shift;
}

function isPrivateIpv6(address: string): boolean {
  const value = expandIpv6(address);
  if (value === null) return true; // unparsable literal -> fail closed, never "known safe"

  if (value === 0n) return true; // :: (unspecified)
  if (value === 1n) return true; // ::1 (loopback)
  if (ipv6PrefixMatches(value, 'fe80::', 10)) return true; // link-local
  if (ipv6PrefixMatches(value, 'fc00::', 7)) return true; // unique-local (fc00::/7)

  // IPv4-mapped addresses (::ffff:0:0/96) — check the embedded IPv4 with the same rules, however the
  // address was spelled (dotted-quad tail, or the raw hex groups the WHATWG URL parser normalizes it
  // to, e.g. "::ffff:169.254.169.254" and "::ffff:a9fe:a9fe" carry the same 128-bit value).
  if (ipv6PrefixMatches(value, '::ffff:0:0', 96)) {
    const v4 = value & 0xffffffffn;
    const octet = (shift: bigint) => Number((v4 >> shift) & 0xffn);
    return isPrivateIpv4(`${octet(24n)}.${octet(16n)}.${octet(8n)}.${octet(0n)}`);
  }

  return false;
}

/**
 * Throws `OutboundUrlValidationError` unless `rawUrl` satisfies `policy` — a well-formed URL on an
 * allowed scheme and port, whose hostname resolves EXCLUSIVELY to public, routable addresses. Resolves
 * the hostname for real (`dns.lookup`) rather than trusting a literal IP alone — literal IPs are also
 * checked directly, without a DNS round-trip, since they're never subject to rebinding but must still
 * be rejected up front.
 *
 * Returns the `ResolvedOutboundUrl` this check just proved safe (or `null` under the testing bypass —
 * see that type's own header) — callers MUST connect their real socket to `.address` (via
 * `pinnedDispatcher`/`pinnedNodeLookup` above) rather than letting `fetch`/`https.request` resolve the
 * hostname a SECOND time on their own. That second, independent resolution is exactly the TOCTOU gap
 * that used to survive re-validating "immediately before every use": a public answer here does not
 * stop a short-TTL DNS record from answering differently a few milliseconds later, when the actual
 * connection's OWN lookup runs ("DNS rebinding") — re-checking without pinning narrows that window,
 * pinning is what actually closes it.
 */
export async function assertPublicOutboundUrl(
  rawUrl: string,
  policy: OutboundUrlPolicy = {},
): Promise<ResolvedOutboundUrl | null> {
  const allowedProtocols = policy.allowedProtocols ?? ['https:'];

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OutboundUrlValidationError('malformed URL');
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new OutboundUrlValidationError('unsupported URL scheme');
  }

  // Dev/test-only escape hatch — NEVER set in production. The scheme check above STILL runs (file:,
  // gopher:… stay rejected); only the port/private/loopback/link-local/DNS checks below are skipped.
  // Nothing was resolved, so there is nothing to pin — `null` tells every caller to connect normally.
  if (policy.allowPrivateForTesting) return null;

  if (policy.allowedPorts !== null) {
    const allowedPorts = policy.allowedPorts ?? [DEFAULT_PORT_FOR_SCHEME[parsed.protocol] ?? 443];
    const effectivePort = parsed.port
      ? Number(parsed.port)
      : (DEFAULT_PORT_FOR_SCHEME[parsed.protocol] ?? 443);
    if (!allowedPorts.includes(effectivePort)) {
      throw new OutboundUrlValidationError('disallowed port');
    }
  }

  const bracketed = parsed.hostname.toLowerCase();
  const hostname = bracketed.startsWith('[') && bracketed.endsWith(']') ? bracketed.slice(1, -1) : bracketed;

  const blockedHostnames =
    policy.blockedHostnames && policy.blockedHostnames.length > 0
      ? new Set([...ALWAYS_BLOCKED_HOSTNAMES, ...policy.blockedHostnames])
      : ALWAYS_BLOCKED_HOSTNAMES;

  if (!hostname || blockedHostnames.has(hostname)) {
    throw new OutboundUrlValidationError('blocked hostname');
  }

  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion === 4) {
    if (isPrivateIpv4(hostname)) throw new OutboundUrlValidationError('literal address is private/internal');
    return { hostname, address: hostname, family: 4 };
  }
  if (literalIpVersion === 6) {
    if (isPrivateIpv6(hostname)) throw new OutboundUrlValidationError('literal address is private/internal');
    return { hostname, address: hostname, family: 6 };
  }

  // Not a literal IP: resolve for real and check every returned address. A hostname can carry both an
  // A and AAAA record, or several of either — one public answer does not make the others safe.
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new OutboundUrlValidationError('hostname does not resolve');
  }

  if (addresses.length === 0) {
    throw new OutboundUrlValidationError('hostname does not resolve');
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (isPrivate) {
      throw new OutboundUrlValidationError('hostname resolves to a private/internal address');
    }
  }

  // Pin to the FIRST validated address — the one a normal client would try first anyway (Node/undici's
  // own Happy Eyeballs ordering), and the only one this function can vouch a caller actually intends
  // to connect to when several were returned.
  const [{ address, family }] = addresses;
  return { hostname, address, family: family === 6 ? 6 : 4 };
}

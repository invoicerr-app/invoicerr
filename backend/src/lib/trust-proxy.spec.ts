import { resolveTrustProxyHops } from './trust-proxy';

describe('resolveTrustProxyHops', () => {
  it("defaults to 1 (today's single-container, nginx-only topology) when unset", () => {
    expect(resolveTrustProxyHops({})).toBe(1);
  });

  it('defaults to 1 when set to an empty or blank string', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '' })).toBe(1);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '   ' })).toBe(1);
  });

  it('honours an explicit hop count — a load balancer in front of the in-container nginx', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  it('honours a larger explicit hop count — several proxies chained in front', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '5' })).toBe(5);
  });

  it('honours 0 explicitly (trust nothing, use the raw socket peer)', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '0' })).toBe(0);
  });

  it('falls back to the safe default on a non-numeric value rather than crashing boot', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: 'banana' })).toBe(1);
  });

  it('falls back to the safe default on a negative value', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '-1' })).toBe(1);
  });

  it('falls back to the safe default on a non-integer value', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1.5' })).toBe(1);
  });
});

/**
 * In-memory bearer-token cache shared by compliance API clients
 * (MyInvois, Coretax, ANAF, ETA, …).
 *
 * Expiry semantics are owned by the caller: the fetcher returns the token
 * together with its absolute `expiresAt` (epoch ms). National APIs differ in
 * where the TTL comes from and when the countdown is anchored (before or
 * after the auth round-trip), so the cache itself only does the
 * check → fetch → store dance.
 */
export class TokenCache {
  private cached?: { token: string; expiresAt: number };

  /** Return the cached token if still valid, otherwise fetch and cache a fresh one. */
  async get(fetchToken: () => Promise<{ token: string; expiresAt: number }>): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.token;
    }
    const fresh = await fetchToken();
    this.cached = fresh;
    return fresh.token;
  }
}

/**
 * Absolute expiry timestamp for a token valid `expiresInSeconds`, minus a
 * clock-skew allowance (default 60 s — the grace period every client here
 * used). `now` lets callers anchor the countdown at the moment they initiated
 * the auth call instead of when the response arrived.
 */
export function tokenExpiry(expiresInSeconds: number, opts: { skewMs?: number; now?: number } = {}): number {
  const { skewMs = 60_000, now = Date.now() } = opts;
  return now + expiresInSeconds * 1000 - skewMs;
}

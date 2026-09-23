/**
 * A REAL fetch against api.github.com — the whole reason this file exists alongside
 * github-release-client.spec.ts's mocked version.
 *
 * A passing mocked suite proves the PARSER is correct against a fixture captured on 2026-09-23 — it
 * proves nothing about whether the endpoint still resolves, still answers JSON in the same shape, or
 * still requires a User-Agent header the way it did when that fixture was captured (this repo's own
 * memory note on KSeF mock tests names the identical false-confidence trap: a green mocked suite is
 * not evidence an external integration still works). ONLY this live suite exercises the real API.
 *
 * Gated the same way every other `*.live.spec.ts` in this codebase is (`transports/live-gate.ts`):
 * silent no-op by default (CI, offline runs), only running when explicitly opted in — no credential
 * env vars are required (this hits a public, keyless, unauthenticated endpoint), so the second
 * `liveDescribe` argument is omitted, same as `open-er-api-rates-client.live.spec.ts`.
 *
 *   GITHUB_RELEASES_LIVE=1 npx vitest run src/modules/version/github-release-client.live.spec.ts
 */

import { vi } from 'vitest';

import { liveDescribe } from '../documents/transports/live-gate';
import { fetchGithubReleases } from './github-release-client';

const describeLive = liveDescribe('GITHUB_RELEASES_LIVE');

describeLive('GitHub releases API — live fetch', () => {
  vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

  it("returns this repository's real, published release list, including v2.0.0-alpha.1", async () => {
    const releases = await fetchGithubReleases();

    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) {
      expect(typeof release.tagName).toBe('string');
      expect(release.tagName.length).toBeGreaterThan(0);
      expect(release.htmlUrl).toMatch(/^https:\/\/github\.com\/invoicerr-app\/invoicerr\/releases\//);
      expect(typeof release.prerelease).toBe('boolean');
    }

    // The concrete release this whole feature is built to handle correctly — published as a
    // pre-release (see project memory, 2026-09-22).
    const currentAlpha = releases.find((r) => r.tagName === 'v2.0.0-alpha.1');
    expect(currentAlpha).toBeDefined();
    expect(currentAlpha?.prerelease).toBe(true);
  });
});

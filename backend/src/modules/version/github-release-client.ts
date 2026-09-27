/**
 * Fetches this repository's own GitHub releases — the one external call `version.service.ts` makes,
 * the thing that lets a running instance learn a newer version exists.
 *
 * Unauthenticated (no token): GitHub's anonymous rate limit is 60 requests/hour PER SOURCE IP
 * (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api, checked 2026-09-23) —
 * plainly enough given `version.service.ts`'s own multi-hour cache, which is the actual thing that
 * keeps this feature inside that budget. This client does not itself track or enforce the limit; a
 * 403/429 response is just reported up as a thrown error like any other failure, and
 * `version.service.ts` then keeps whatever it already had cached rather than surfacing it.
 *
 * `GET /releases` (the LIST endpoint), never `/releases/latest`: the latter answers "the newest
 * non-prerelease, non-draft release" ONLY — exactly wrong for an instance that is itself running a
 * pre-release (`v2.0.0-alpha.1` today), which needs to be compared against the newest release of ANY
 * kind, not silently pointed at an older stable tag (this repository's own release list, checked
 * 2026-09-23: `v1.4.5c` is "Latest" by GitHub's own definition, and is OLDER than
 * `v2.0.0-alpha.1`). `version.service.ts` is where the actual stable-vs-prerelease POLICY lives —
 * this file only ever hands it the raw list.
 *
 * `per_page=30`: comfortably more than this repository's release count at the time of writing
 * (~10), fetched newest-created-first by GitHub's own default ordering. No pagination — a "latest"
 * search missing a much older release cannot change which one is newest.
 *
 * A `User-Agent` header is NOT optional for this API: an unauthenticated request without one is
 * rejected with HTTP 403 (docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api),
 * unlike almost every other public HTTP API. Missing it here would look exactly like being
 * rate-limited and silently disable this feature on every self-hosted instance.
 */

const GITHUB_REPO = 'invoicerr-app/invoicerr';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;

/** Short and non-negotiable: this call happens on the request path of `GET /api/version`
 *  (`version.service.ts`), so a hang here must never be allowed to hold that response open — see
 *  that file's own header for the "never blocking" contract this bounds. */
const FETCH_TIMEOUT_MS = 5_000;

export interface GithubRelease {
  tagName: string;
  htmlUrl: string;
  prerelease: boolean;
}

/** The seam `version.module.ts` swaps on `GITHUB_RELEASES_FAKE=1` (see `fake-github-release-client.ts`
 *  and `clients.module.ts`'s own `vatValidationClient()` for the exact precedent this mirrors) — so
 *  `version.service.ts` depends on this interface, never on `fetchGithubReleases` directly. */
export interface GithubReleaseClientPort {
  fetchReleases(): Promise<GithubRelease[]>;
}

export class RealGithubReleaseClient implements GithubReleaseClientPort {
  fetchReleases(): Promise<GithubRelease[]> {
    return fetchGithubReleases();
  }
}

interface GithubReleaseApiEntry {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

/**
 * Never returns a half-parsed entry: any list item missing a usable `tag_name` is dropped rather
 * than handed on as `tagName: undefined`. Drafts are filtered out defensively even though an
 * unauthenticated request should never see one at all (GitHub does not return draft releases to a
 * caller without push access to the repository).
 */
export async function fetchGithubReleases(): Promise<GithubRelease[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetch(RELEASES_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'invoicerr-instance-update-check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub releases API responded with HTTP ${response.status}`);
    }
    body = await response.json();
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(body)) {
    throw new Error('GitHub releases API did not return a list.');
  }

  return (body as GithubReleaseApiEntry[])
    .filter((entry) => typeof entry.tag_name === 'string' && entry.tag_name.length > 0 && !entry.draft)
    .map((entry) => ({
      tagName: entry.tag_name as string,
      htmlUrl:
        typeof entry.html_url === 'string'
          ? entry.html_url
          : `https://github.com/${GITHUB_REPO}/releases/tag/${entry.tag_name}`,
      prerelease: entry.prerelease === true,
    }));
}

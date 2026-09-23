/**
 * Backs `GET /api/version` — issue #371: show the installed version, and tell the operator when a
 * newer one has been published, without ever putting a self-hosted instance with no outbound access
 * at risk. That contract, concretely:
 *
 *  - NEVER BLOCKING: this is called from the request path (the frontend polls it, long `staleTime` —
 *    see `hooks/queries/use-version.ts`), never from `main.ts`'s boot sequence and never on a cron.
 *    `github-release-client.ts`'s own `FETCH_TIMEOUT_MS` (5s) bounds the one network call this makes.
 *  - CACHED: at most one real GitHub call per `CACHE_TTL_MS` window (6h — at most 4/day regardless of
 *    how much traffic hits this endpoint), and concurrent callers landing while the cache is cold
 *    share the SAME in-flight request rather than each firing their own.
 *  - NEVER AN ERROR TO THE CALLER: a failed GitHub call (network down, rate-limited, DNS — exactly
 *    what "no outbound access" looks like) is caught here and swallowed. The endpoint still answers
 *    200 with `updateAvailable: false` and whatever was last known (or nothing, on a cold cache) —
 *    never a 5xx, never a banner the frontend has to specifically handle as an error state. It is
 *    logged at most once per cache window, not once per request — see `refresh()` below.
 *  - AN EXPLICIT OFF SWITCH still exists (`DISABLE_UPDATE_CHECK`, `update-check-flag.ts`) for an
 *    operator who wants zero outbound calls as a matter of policy, not because the above is unsafe.
 *
 * ## The pre-release policy — the "honest comparison" the issue asks for
 * This product ships pre-releases (`v2.0.0-alpha.1` today, marked pre-release on GitHub) — a
 * pre-release must never be announced as an update to someone running a stable version. The rule
 * this enforces:
 *   - Current version is a STABLE release (no pre-release identifier) -> only ever compared against
 *     the newest STABLE release GitHub has (pre-releases are filtered out of the candidate list
 *     entirely before the max is even computed).
 *   - Current version is ITSELF a pre-release -> compared against the newest release of ANY kind
 *     (stable or pre-release) — a pre-release user is on the bleeding-edge channel on purpose and
 *     should see a further pre-release OR the stable release that eventually supersedes it; comparing
 *     them only against `/releases/latest` (GitHub's own "newest non-prerelease" endpoint) would be
 *     actively WRONG today: this repo's actual "Latest" release is `v1.4.5c`, which is OLDER than
 *     `v2.0.0-alpha.1` (see `github-release-client.ts`'s own header). `updateAvailable` is still only
 *     ever true for a candidate that is genuinely NEWER by SemVer precedence — a stable user is never
 *     told an older release is an "update" just because it happens to be the only stable one to
 *     compare against.
 * Anything that is not a comparable SemVer string at all — `getInstalledVersion()` returned the
 * `package.json` fallback, or a branch-name build (`INVOICERR_REF_NAME=dev`) — skips the check
 * entirely: the version is still shown, `updateAvailable` is simply always `false`, never guessed.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { getInstalledVersion } from '@/lib/app-version';
import { type ParsedVersion, compareVersions, isPrerelease, parseVersion } from '@/lib/semver-lite';

import type { GithubRelease, GithubReleaseClientPort } from './github-release-client';
import { isUpdateCheckDisabled } from './update-check-flag';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface VersionInfo {
  /** The exact string to show the operator — a build-ref git tag/branch, or the package.json
   *  fallback for a non-Docker run. Always present. */
  currentVersion: string;
  /** The newest comparable release found under the policy above, or `null` when none was found, the
   *  current version is not itself comparable, the check is disabled, or the last attempt failed. */
  latestVersion: string | null;
  /** Where to send the operator to read about it — the GitHub release page, or `null` alongside a
   *  `null` latestVersion. */
  latestUrl: string | null;
  updateAvailable: boolean;
  /** When the cached answer was last actually refreshed (a real fetch attempt, success or failure) —
   *  `null` until the first attempt has happened at all. Never "now" on every request: most requests
   *  are served straight from cache. */
  checkedAt: string | null;
}

function emptyResult(currentVersion: string, checkedAt: string | null = null): VersionInfo {
  return { currentVersion, latestVersion: null, latestUrl: null, updateAvailable: false, checkedAt };
}

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private cached: VersionInfo | null = null;
  private cachedAt = 0;
  private inFlight: Promise<VersionInfo> | null = null;

  constructor(
    @Inject('GITHUB_RELEASE_CLIENT') private readonly githubReleaseClient: GithubReleaseClientPort,
  ) {}

  async getVersionInfo(): Promise<VersionInfo> {
    const current = getInstalledVersion();

    if (isUpdateCheckDisabled()) {
      return emptyResult(current.version);
    }

    const parsedCurrent = parseVersion(current.version);
    if (!parsedCurrent) {
      // Not a comparable release version (a branch build, the package.json fallback, "unknown"...) —
      // show it plainly, never guess at an update from it.
      return emptyResult(current.version);
    }

    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) {
      return { ...this.cached, currentVersion: current.version };
    }

    // Coalesce concurrent callers onto the SAME in-flight fetch — several requests landing while the
    // cache is cold (or has just expired) must not each fire their own call to GitHub.
    if (!this.inFlight) {
      this.inFlight = this.refresh(current.version, parsedCurrent).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async refresh(currentVersionString: string, parsedCurrent: ParsedVersion): Promise<VersionInfo> {
    // Stamped BEFORE the network call, unconditionally: a failure must still back off for the full
    // TTL, never retried on the very next request a moment later — that IS the "at most once per
    // window, success or not" bound this class promises.
    this.cachedAt = Date.now();

    let releases: GithubRelease[];
    try {
      releases = await this.githubReleaseClient.fetchReleases();
    } catch (err) {
      // Never surfaced to the frontend as an error — an unreachable GitHub is the EXPECTED shape for
      // a self-hosted instance with no outbound access, not a fault. Logged once per cache window
      // (bounded by the cachedAt stamp above), never per request.
      this.logger.warn(
        `Update check failed, will retry in ${Math.round(CACHE_TTL_MS / 3_600_000)}h: ${(err as Error).message}`,
      );
      // Keep any previous good answer rather than flip a working "you're up to date" into "unknown"
      // just because GitHub happened to be unreachable on this one attempt.
      this.cached = this.cached ?? emptyResult(currentVersionString, new Date(this.cachedAt).toISOString());
      return { ...this.cached, currentVersion: currentVersionString };
    }

    const currentIsPrerelease = isPrerelease(parsedCurrent);
    let best: { parsed: ParsedVersion; release: GithubRelease } | null = null;
    for (const release of releases) {
      // The pre-release policy — see this file's own header.
      if (!currentIsPrerelease && release.prerelease) continue;
      const parsed = parseVersion(release.tagName);
      if (!parsed) continue; // e.g. this repo's own older, non-SemVer v1.4.x lettered tags
      if (!best || compareVersions(parsed, best.parsed) > 0) {
        best = { parsed, release };
      }
    }

    const result: VersionInfo = {
      currentVersion: currentVersionString,
      latestVersion: best?.release.tagName ?? null,
      latestUrl: best?.release.htmlUrl ?? null,
      updateAvailable: best ? compareVersions(best.parsed, parsedCurrent) > 0 : false,
      checkedAt: new Date(this.cachedAt).toISOString(),
    };
    this.cached = result;
    return result;
  }
}

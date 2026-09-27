/**
 * A tiny, dependency-free SemVer 2.0.0 precedence comparator — just enough for
 * `modules/version/version.service.ts` to decide "is the latest GitHub release actually newer than
 * what's installed", including the one rule that matters most here: a pre-release (`2.0.0-alpha.1`)
 * has LOWER precedence than the same core version without one (`2.0.0`), and between two
 * pre-releases the dot-separated identifiers compare numerically when both sides are digits-only,
 * lexically otherwise (SemVer spec §11). No `semver` package: this project has never depended on
 * one, and the full spec (build metadata, ranges, coercion) is far more than this one comparison
 * needs.
 *
 * Deliberately STRICT, not lenient: `parseVersion` returns `null` for anything that is not exactly
 * `[v]MAJOR.MINOR.PATCH[-prerelease]` (an optional leading "v", nothing after — no trailing text, no
 * build metadata). This repository's own OLDER release tags (`v1.4.6b`, `v1.4.5c` — a lettered-suffix
 * scheme that predates this product's move to proper SemVer for `v2.0.0-alpha.1`) do NOT parse: they
 * are silently excluded from `version.service.ts`'s "latest" search rather than mis-parsed into a
 * truncated, wrong number. That is correct, not a gap — a build that can even RUN this code is by
 * construction already on `v2.0.0-alpha.1` or later, so no real comparison ever needs to reach that
 * older scheme.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated identifiers after the `-`; an empty array means "not a pre-release". */
  prerelease: string[];
  /** The exact string this was parsed from (whatever case/prefix it came in as). */
  raw: string;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : [],
    raw: input,
  };
}

export function isPrerelease(version: ParsedVersion): boolean {
  return version.prerelease.length > 0;
}

/**
 * SemVer precedence: negative when `a` < `b`, positive when `a` > `b`, `0` when equal.
 * Core version fields (major/minor/patch) compare numerically first. A pre-release always has LOWER
 * precedence than the same core version without one (SemVer §11.3). Between two pre-releases,
 * identifiers compare pairwise: numeric identifiers compare as numbers, alphanumeric ones lexically,
 * and a purely-numeric identifier always has lower precedence than an alphanumeric one at the same
 * position (§11.4.3); when one identifier list is a strict prefix of the other, the longer one wins
 * (§11.4.4).
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1; // a is a full release, b is a pre-release of the same core version
  if (bPre.length === 0) return -1;

  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    const ai = aPre[i];
    const bi = bPre[i];
    if (ai === undefined) return -1; // a ran out first: fewer fields = lower precedence
    if (bi === undefined) return 1;
    const aIsNumeric = /^\d+$/.test(ai);
    const bIsNumeric = /^\d+$/.test(bi);
    if (aIsNumeric && bIsNumeric) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aIsNumeric !== bIsNumeric) {
      return aIsNumeric ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

export function isNewer(candidate: ParsedVersion, than: ParsedVersion): boolean {
  return compareVersions(candidate, than) > 0;
}

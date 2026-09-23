import { compareVersions, isNewer, isPrerelease, parseVersion } from './semver-lite';

describe('parseVersion', () => {
  it('parses a plain core version', () => {
    expect(parseVersion('2.0.0')).toEqual({ major: 2, minor: 0, patch: 0, prerelease: [], raw: '2.0.0' });
  });

  it('accepts an optional leading "v"', () => {
    expect(parseVersion('v2.0.0')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: [],
      raw: 'v2.0.0',
    });
  });

  it('parses a dotted pre-release identifier', () => {
    expect(parseVersion('v2.0.0-alpha.1')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', '1'],
      raw: 'v2.0.0-alpha.1',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseVersion('  v2.0.0  ')).not.toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseVersion('')).toBeNull();
  });

  it('rejects a bare branch name', () => {
    expect(parseVersion('dev')).toBeNull();
    expect(parseVersion('main')).toBeNull();
    expect(parseVersion('feat/371-display-version')).toBeNull();
  });

  it('rejects "unknown" (the Dockerfile ARG default when GIT_REF_NAME is not passed)', () => {
    expect(parseVersion('unknown')).toBeNull();
  });

  it("rejects this repository's own OLDER lettered-suffix tags (v1.4.6b) — no hyphen, not SemVer", () => {
    expect(parseVersion('v1.4.6b')).toBeNull();
    expect(parseVersion('v1.4.5c')).toBeNull();
  });

  it('rejects trailing build metadata or extra text', () => {
    expect(parseVersion('2.0.0+build.5')).toBeNull();
    expect(parseVersion('2.0.0 (unofficial)')).toBeNull();
  });

  it('rejects a version missing the patch component', () => {
    expect(parseVersion('2.0')).toBeNull();
  });
});

describe('isPrerelease', () => {
  it('is false for a full release', () => {
    expect(isPrerelease(parseVersion('2.0.0')!)).toBe(false);
  });

  it('is true for a pre-release', () => {
    expect(isPrerelease(parseVersion('2.0.0-alpha.1')!)).toBe(true);
  });
});

describe('compareVersions', () => {
  const cmp = (a: string, b: string) => compareVersions(parseVersion(a)!, parseVersion(b)!);

  it('orders by major/minor/patch first', () => {
    expect(cmp('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(cmp('1.4.0', '1.5.0')).toBeLessThan(0);
    expect(cmp('1.4.1', '1.4.0')).toBeGreaterThan(0);
    expect(cmp('1.4.0', '1.4.0')).toBe(0);
  });

  // The exact scenario the issue calls out: the product ships v2.0.0-alpha.1 today, marked
  // pre-release on GitHub, and a pre-release must never look "newer or equal" to the stable release
  // it is a pre-release OF.
  it('a pre-release has LOWER precedence than the same core version released', () => {
    expect(cmp('2.0.0-alpha.1', '2.0.0')).toBeLessThan(0);
    expect(cmp('2.0.0', '2.0.0-alpha.1')).toBeGreaterThan(0);
  });

  it('among pre-releases of the same core version, later alpha wins', () => {
    expect(cmp('2.0.0-alpha.1', '2.0.0-alpha.2')).toBeLessThan(0);
  });

  it('compares numeric pre-release identifiers numerically, not lexically (9 < 10)', () => {
    expect(cmp('2.0.0-alpha.9', '2.0.0-alpha.10')).toBeLessThan(0);
  });

  it('an alphanumeric identifier outranks a purely numeric one at the same position', () => {
    expect(cmp('2.0.0-alpha.1', '2.0.0-beta.1')).toBeLessThan(0); // "alpha" < "beta" lexically
    expect(cmp('2.0.0-1', '2.0.0-alpha')).toBeLessThan(0); // numeric identifier < alphanumeric one
  });

  it('a longer pre-release identifier list outranks a strict prefix of itself', () => {
    expect(cmp('2.0.0-alpha', '2.0.0-alpha.1')).toBeLessThan(0);
  });

  it('is symmetric (swapping operands flips the sign)', () => {
    expect(cmp('2.0.0-alpha.1', '2.0.0')).toBe(-cmp('2.0.0', '2.0.0-alpha.1'));
  });
});

describe('isNewer', () => {
  it('is true only when the candidate strictly outranks the baseline', () => {
    const alpha1 = parseVersion('v2.0.0-alpha.1')!;
    const alpha2 = parseVersion('v2.0.0-alpha.2')!;
    const stable = parseVersion('v2.0.0')!;

    expect(isNewer(alpha2, alpha1)).toBe(true);
    expect(isNewer(alpha1, alpha2)).toBe(false);
    expect(isNewer(stable, alpha1)).toBe(true);
    expect(isNewer(alpha1, stable)).toBe(false);
    expect(isNewer(alpha1, alpha1)).toBe(false); // equal is not "newer"
  });
});

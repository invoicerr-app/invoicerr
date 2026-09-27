import { getInstalledVersion, readBackendPackageJsonVersion } from './app-version';

describe('readBackendPackageJsonVersion', () => {
  it('resolves the real backend/package.json version, relative to this file not cwd', () => {
    // Deliberately not asserting a specific value — package.json's own version is free to change.
    // What matters is that this resolves at all (the twin-path __dirname lookup found a real file)
    // and returns a non-empty string, from wherever this test actually runs from.
    const version = readBackendPackageJsonVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });
});

describe('getInstalledVersion', () => {
  const ORIGINAL_ENV = process.env.INVOICERR_REF_NAME;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.INVOICERR_REF_NAME;
    } else {
      process.env.INVOICERR_REF_NAME = ORIGINAL_ENV;
    }
  });

  it('prefers INVOICERR_REF_NAME (the real build-time git ref) when set', () => {
    process.env.INVOICERR_REF_NAME = 'v2.0.0-alpha.1';

    expect(getInstalledVersion()).toEqual({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
  });

  it('falls back to package.json when INVOICERR_REF_NAME is unset', () => {
    delete process.env.INVOICERR_REF_NAME;

    const result = getInstalledVersion();

    expect(result.fromBuildRef).toBe(false);
    expect(result.version).toBe(readBackendPackageJsonVersion());
  });

  it('falls back to package.json when INVOICERR_REF_NAME is "unknown" (the Dockerfile ARG default)', () => {
    process.env.INVOICERR_REF_NAME = 'unknown';

    const result = getInstalledVersion();

    expect(result.fromBuildRef).toBe(false);
    expect(result.version).toBe(readBackendPackageJsonVersion());
  });

  it('passes a branch-name build ref through as-is (a dev/PR image, not a release)', () => {
    process.env.INVOICERR_REF_NAME = 'dev';

    expect(getInstalledVersion()).toEqual({ version: 'dev', fromBuildRef: true });
  });
});

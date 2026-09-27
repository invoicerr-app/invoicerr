import { type Mock, vi } from 'vitest';

import { getInstalledVersion } from '@/lib/app-version';

import type { GithubRelease, GithubReleaseClientPort } from './github-release-client';
import { isUpdateCheckDisabled } from './update-check-flag';
import { VersionService } from './version.service';

vi.mock('@/lib/app-version');
vi.mock('./update-check-flag');

const mockedGetInstalledVersion = getInstalledVersion as Mock;
const mockedIsUpdateCheckDisabled = isUpdateCheckDisabled as Mock;

/** The exact live release list shape this repo actually has as of 2026-09-23: one pre-release ahead
 *  of everything else, plus older non-SemVer lettered tags mixed in. */
const REALISTIC_RELEASES: GithubRelease[] = [
  { tagName: 'v2.0.0-alpha.1', htmlUrl: 'https://github.com/.../v2.0.0-alpha.1', prerelease: true },
  { tagName: 'v1.4.6b', htmlUrl: 'https://github.com/.../v1.4.6b', prerelease: true },
  { tagName: 'v1.4.5c', htmlUrl: 'https://github.com/.../v1.4.5c', prerelease: false },
];

/** A fake of the injected `GithubReleaseClientPort` — the same "construct the service with a plain
 *  fake object, no module mocking" shape this port exists to enable in the first place (see
 *  `fake-github-release-client.ts`'s own header for its REAL e2e counterpart). */
function fakeGithubReleaseClient(): GithubReleaseClientPort & { fetchReleases: Mock } {
  return { fetchReleases: vi.fn() };
}

describe('VersionService.getVersionInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    mockedIsUpdateCheckDisabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('reports no update when the installed version already IS the newest matching release', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue(REALISTIC_RELEASES);

    const info = await new VersionService(client).getVersionInfo();

    expect(info).toEqual({
      currentVersion: 'v2.0.0-alpha.1',
      latestVersion: 'v2.0.0-alpha.1',
      latestUrl: 'https://github.com/.../v2.0.0-alpha.1',
      updateAvailable: false,
      checkedAt: '2026-09-23T12:00:00.000Z',
    });
  });

  it('reports an update when a newer pre-release exists and the instance is itself on a pre-release', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue([
      { tagName: 'v2.0.0-alpha.2', htmlUrl: 'https://github.com/.../v2.0.0-alpha.2', prerelease: true },
      ...REALISTIC_RELEASES,
    ]);

    const info = await new VersionService(client).getVersionInfo();

    expect(info.updateAvailable).toBe(true);
    expect(info.latestVersion).toBe('v2.0.0-alpha.2');
  });

  // The exact scenario the issue calls out by name: a pre-release must not be announced as an
  // update to someone running a STABLE version.
  it('never announces a pre-release as an update to an instance running a stable version', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v1.4.0', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue([
      { tagName: 'v2.0.0-alpha.1', htmlUrl: 'https://github.com/.../v2.0.0-alpha.1', prerelease: true },
      { tagName: 'v1.4.5c', htmlUrl: 'https://github.com/.../v1.4.5c', prerelease: false },
    ]);

    const info = await new VersionService(client).getVersionInfo();

    // v1.4.5c does not parse (non-SemVer lettered suffix) so there is no comparable stable candidate
    // at all here — proving the pre-release v2.0.0-alpha.1 was never even considered, not just that
    // it lost a comparison.
    expect(info.latestVersion).toBeNull();
    expect(info.updateAvailable).toBe(false);
  });

  it('announces a stable update to a stable instance when one is genuinely newer', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v1.4.0', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue([
      { tagName: 'v2.0.0-alpha.1', htmlUrl: 'https://github.com/.../v2.0.0-alpha.1', prerelease: true },
      { tagName: 'v1.5.0', htmlUrl: 'https://github.com/.../v1.5.0', prerelease: false },
    ]);

    const info = await new VersionService(client).getVersionInfo();

    expect(info.latestVersion).toBe('v1.5.0');
    expect(info.updateAvailable).toBe(true);
  });

  it('skips the check entirely for a non-SemVer current version (a branch build) without throwing', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'dev', fromBuildRef: true });
    const client = fakeGithubReleaseClient();

    const info = await new VersionService(client).getVersionInfo();

    expect(info).toEqual({
      currentVersion: 'dev',
      latestVersion: null,
      latestUrl: null,
      updateAvailable: false,
      checkedAt: null,
    });
    expect(client.fetchReleases).not.toHaveBeenCalled();
  });

  it('honours DISABLE_UPDATE_CHECK and never calls GitHub at all', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    mockedIsUpdateCheckDisabled.mockReturnValue(true);
    const client = fakeGithubReleaseClient();

    const info = await new VersionService(client).getVersionInfo();

    expect(info.updateAvailable).toBe(false);
    expect(client.fetchReleases).not.toHaveBeenCalled();
  });

  it('never throws when GitHub is unreachable — swallows the error and reports no update', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockRejectedValue(new Error('fetch failed: getaddrinfo ENOTFOUND'));

    const info = await new VersionService(client).getVersionInfo();

    expect(info.currentVersion).toBe('v2.0.0-alpha.1');
    expect(info.updateAvailable).toBe(false);
    expect(info.latestVersion).toBeNull();
  });

  it('keeps a previous good answer instead of flipping to unknown on a later transient failure', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValueOnce([
      { tagName: 'v2.0.0-alpha.2', htmlUrl: 'https://github.com/.../v2.0.0-alpha.2', prerelease: true },
    ]);

    const service = new VersionService(client);
    const first = await service.getVersionInfo();
    expect(first.latestVersion).toBe('v2.0.0-alpha.2');

    // Expire the cache, then have GitHub fail on the second attempt.
    vi.setSystemTime(new Date('2026-09-23T19:00:01.000Z')); // > 6h later
    client.fetchReleases.mockRejectedValueOnce(new Error('HTTP 403'));

    const second = await service.getVersionInfo();
    expect(second.latestVersion).toBe('v2.0.0-alpha.2'); // stale but still the last GOOD answer
  });

  it('does not call GitHub again within the cache window', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue(REALISTIC_RELEASES);

    const service = new VersionService(client);
    await service.getVersionInfo();
    await service.getVersionInfo();
    vi.setSystemTime(new Date('2026-09-23T15:00:00.000Z')); // +3h, still within the 6h TTL
    await service.getVersionInfo();

    expect(client.fetchReleases).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once the cache window has elapsed', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    client.fetchReleases.mockResolvedValue(REALISTIC_RELEASES);

    const service = new VersionService(client);
    await service.getVersionInfo();
    vi.setSystemTime(new Date('2026-09-23T19:00:01.000Z')); // +7h, past the 6h TTL
    await service.getVersionInfo();

    expect(client.fetchReleases).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent callers onto a single in-flight GitHub call', async () => {
    mockedGetInstalledVersion.mockReturnValue({ version: 'v2.0.0-alpha.1', fromBuildRef: true });
    const client = fakeGithubReleaseClient();
    let resolveFetch!: (value: GithubRelease[]) => void;
    client.fetchReleases.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const service = new VersionService(client);
    const [a, b] = [service.getVersionInfo(), service.getVersionInfo()];
    resolveFetch(REALISTIC_RELEASES);
    await Promise.all([a, b]);

    expect(client.fetchReleases).toHaveBeenCalledTimes(1);
  });
});

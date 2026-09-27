import { parseVersion } from '@/lib/semver-lite';

import { FakeGithubReleaseClient } from './fake-github-release-client';

describe('FakeGithubReleaseClient', () => {
  it('returns exactly one fake, non-prerelease release, parseable as SemVer', async () => {
    const releases = await new FakeGithubReleaseClient().fetchReleases();

    expect(releases).toHaveLength(1);
    expect(releases[0].prerelease).toBe(false);
    expect(parseVersion(releases[0].tagName)).not.toBeNull();
    expect(releases[0].htmlUrl).toContain('invoicerr-app/invoicerr');
  });
});

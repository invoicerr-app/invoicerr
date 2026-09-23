import { vi } from 'vitest';

import { fetchGithubReleases } from './github-release-client';

/** Trimmed but structurally real fixture — shaped like a real
 *  `GET https://api.github.com/repos/invoicerr-app/invoicerr/releases` response (verified live,
 *  2026-09-23), just with four entries instead of the repository's full history. */
const FIXTURE_BODY = [
  {
    tag_name: 'v2.0.0-alpha.1',
    html_url: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v2.0.0-alpha.1',
    prerelease: true,
    draft: false,
  },
  {
    tag_name: 'v1.4.6b',
    html_url: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v1.4.6b',
    prerelease: true,
    draft: false,
  },
  {
    tag_name: 'v1.4.5c',
    html_url: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v1.4.5c',
    prerelease: false,
    draft: false,
  },
  // A draft is not something an unauthenticated caller should ever actually receive, but the parser
  // defends against it anyway — see this file's own header.
  {
    tag_name: 'v2.0.0-alpha.2',
    html_url: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v2.0.0-alpha.2',
    prerelease: true,
    draft: true,
  },
];

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('fetchGithubReleases', () => {
  afterEach(() => vi.resetAllMocks());

  it('parses every non-draft release from the fixture', async () => {
    mockFetchOnce(FIXTURE_BODY);

    const releases = await fetchGithubReleases();

    expect(releases).toEqual([
      {
        tagName: 'v2.0.0-alpha.1',
        htmlUrl: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v2.0.0-alpha.1',
        prerelease: true,
      },
      {
        tagName: 'v1.4.6b',
        htmlUrl: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v1.4.6b',
        prerelease: true,
      },
      {
        tagName: 'v1.4.5c',
        htmlUrl: 'https://github.com/invoicerr-app/invoicerr/releases/tag/v1.4.5c',
        prerelease: false,
      },
    ]);
  });

  it('sends a User-Agent header — GitHub 403s an unauthenticated request without one', async () => {
    mockFetchOnce(FIXTURE_BODY);

    await fetchGithubReleases();

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toBeTruthy();
  });

  it('falls back to a constructed release URL when html_url is missing', async () => {
    mockFetchOnce([{ tag_name: 'v9.9.9', prerelease: false, draft: false }]);

    const [release] = await fetchGithubReleases();

    expect(release.htmlUrl).toBe('https://github.com/invoicerr-app/invoicerr/releases/tag/v9.9.9');
  });

  it('drops list entries with no usable tag_name', async () => {
    mockFetchOnce([{ prerelease: false, draft: false }, ...FIXTURE_BODY.slice(0, 1)]);

    const releases = await fetchGithubReleases();

    expect(releases).toHaveLength(1);
    expect(releases[0].tagName).toBe('v2.0.0-alpha.1');
  });

  it('throws when the HTTP response itself is not ok (e.g. rate-limited)', async () => {
    mockFetchOnce({}, false, 403);

    await expect(fetchGithubReleases()).rejects.toThrow(/HTTP 403/);
  });

  it('throws when the response body is not a list', async () => {
    mockFetchOnce({ message: 'Not Found' });

    await expect(fetchGithubReleases()).rejects.toThrow(/did not return a list/);
  });
});

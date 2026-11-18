import { allowedBrowserOrigins, DEV_FRONTEND_ORIGIN, devOnlyOrigins } from '@/lib/dev-origins';

describe('devOnlyOrigins', () => {
  it('trusts the Vite dev-server origin outside production', () => {
    expect(devOnlyOrigins({ NODE_ENV: 'development' })).toEqual([DEV_FRONTEND_ORIGIN]);
    expect(devOnlyOrigins({ NODE_ENV: 'test' })).toEqual([DEV_FRONTEND_ORIGIN]);
    expect(devOnlyOrigins({})).toEqual([DEV_FRONTEND_ORIGIN]); // NODE_ENV unset — plain local dev
  });

  it('never trusts it in production — the actual vulnerability this closes', () => {
    expect(devOnlyOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });
});

describe('allowedBrowserOrigins', () => {
  it('lists APP_URL and each trimmed CORS_ORIGINS entry, dropping empty ones', () => {
    expect(
      allowedBrowserOrigins({
        NODE_ENV: 'production',
        APP_URL: 'https://app.example',
        CORS_ORIGINS: ' https://a.example,, https://b.example ',
      }),
    ).toEqual(['https://app.example', 'https://a.example', 'https://b.example']);
  });

  it('adds the dev origin only outside production', () => {
    expect(allowedBrowserOrigins({ NODE_ENV: 'development' })).toEqual([DEV_FRONTEND_ORIGIN]);
    expect(allowedBrowserOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });
});

import { DEV_FRONTEND_ORIGIN, devOnlyOrigins } from '@/lib/dev-origins';

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

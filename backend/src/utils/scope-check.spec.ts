import { hasScope } from '@/utils/scope-check';

describe('hasScope', () => {
  it('always passes for session auth (scopes === null)', () => {
    expect(hasScope({ scopes: null }, 'quotes:write')).toBe(true);
    expect(hasScope({ scopes: null }, 'articles:read')).toBe(true);
  });

  it('passes when the API key has the requested scope', () => {
    expect(hasScope({ scopes: ['quotes:write', 'clients:write'] }, 'quotes:write')).toBe(true);
  });

  it('fails when the API key lacks the requested scope', () => {
    expect(hasScope({ scopes: ['clients:write'] }, 'quotes:write')).toBe(false);
  });

  it('fails for an API key with an empty scope set', () => {
    expect(hasScope({ scopes: [] }, 'quotes:write')).toBe(false);
  });
});

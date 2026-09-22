import { generatePortalToken, hashPortalToken } from './portal-token';

describe('portal-token', () => {
  it('mints a 256-bit (64 hex char) token whose hash never equals the raw token', () => {
    const { token, tokenHash } = generatePortalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(token);
  });

  it('two mints never collide (entropy sanity, not a formal proof)', () => {
    const a = generatePortalToken();
    const b = generatePortalToken();
    expect(a.token).not.toBe(b.token);
  });

  it('hashPortalToken is deterministic', () => {
    const { token, tokenHash } = generatePortalToken();
    expect(hashPortalToken(token)).toBe(tokenHash);
  });
});

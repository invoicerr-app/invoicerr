import { effectiveAuthSecret } from '@/lib/auth-secret';

describe('effectiveAuthSecret', () => {
  it('prefers BETTER_AUTH_SECRET', () => {
    expect(effectiveAuthSecret({ BETTER_AUTH_SECRET: 'a', JWT_SECRET: 'b' })).toBe('a');
  });

  it('falls back to JWT_SECRET when BETTER_AUTH_SECRET is unset or empty', () => {
    expect(effectiveAuthSecret({ JWT_SECRET: 'b' })).toBe('b');
    expect(effectiveAuthSecret({ BETTER_AUTH_SECRET: '', JWT_SECRET: 'b' })).toBe('b');
  });

  it('is undefined when neither is set', () => {
    expect(effectiveAuthSecret({})).toBeUndefined();
  });
});

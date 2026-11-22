import { describe, expect, it } from 'vitest';

import { demoBlockedAuthActionLabel, isDemoBlockedAuthPath } from './demo-auth-paths';

describe('isDemoBlockedAuthPath: the better-auth hooks.before matcher (issue #533)', () => {
  it('blocks changing the email', () => {
    expect(isDemoBlockedAuthPath('/change-email')).toBe(true);
  });

  it('blocks changing the password', () => {
    expect(isDemoBlockedAuthPath('/change-password')).toBe(true);
  });

  it.each(['/two-factor/enable', '/two-factor/disable', '/two-factor/generate-backup-codes'])(
    'blocks changing the shared demo account second factor: %s',
    (path) => {
      expect(isDemoBlockedAuthPath(path)).toBe(true);
      expect(demoBlockedAuthActionLabel(path)).toBe('Changing two-factor authentication');
    },
  );

  it.each([
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
    '/sign-in/email',
    '/get-session',
    '/sign-up/email',
    '/delete-user',
    '/callback/google',
    '/',
  ])('does not touch an unrelated better-auth route: %s', (path) => {
    expect(isDemoBlockedAuthPath(path)).toBe(false);
  });

  it('labels each blocked path distinctly', () => {
    expect(demoBlockedAuthActionLabel('/change-email')).toBe('Changing the account email');
    expect(demoBlockedAuthActionLabel('/change-password')).toBe('Changing the password');
  });
});

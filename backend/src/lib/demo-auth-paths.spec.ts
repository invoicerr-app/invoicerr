import { describe, expect, it } from 'vitest';

import { demoBlockedAuthActionLabel } from './demo-auth-paths';

describe('demoBlockedAuthActionLabel: the better-auth hooks.before matcher (issue #533)', () => {
  it('blocks changing the email', () => {
    expect(demoBlockedAuthActionLabel('/change-email')).toBe('Changing the account email');
  });

  it('blocks changing the password', () => {
    expect(demoBlockedAuthActionLabel('/change-password')).toBe('Changing the password');
  });

  it.each(['/two-factor/enable', '/two-factor/disable', '/two-factor/generate-backup-codes'])(
    'blocks changing the shared demo account second factor: %s',
    (path) => {
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
    expect(demoBlockedAuthActionLabel(path)).toBeNull();
  });
});

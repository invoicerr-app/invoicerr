import { describe, expect, it } from 'vitest';

import { twoFactor } from 'better-auth/plugins';

import { TWO_FACTOR_OPTIONS } from './two-factor-options';

describe('TWO_FACTOR_OPTIONS: the second factor wired into lib/auth.ts', () => {
  it('labels the authenticator entry Invoicerr', () => {
    expect(TWO_FACTOR_OPTIONS.issuer).toBe('Invoicerr');
  });

  it('requires the password to enable or disable it, so a stolen session cannot remove it', () => {
    expect(TWO_FACTOR_OPTIONS.allowPasswordless).toBe(false);
  });

  it('offers no email code as a second factor', () => {
    expect('otpOptions' in TWO_FACTOR_OPTIONS).toBe(false);
  });

  it('builds a plugin that intercepts the password sign-in and exposes the verify routes', () => {
    const plugin = twoFactor(TWO_FACTOR_OPTIONS);
    const paths = Object.values(plugin.endpoints).map((endpoint) => endpoint.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/two-factor/enable',
        '/two-factor/disable',
        '/two-factor/verify-totp',
        '/two-factor/verify-backup-code',
        '/two-factor/generate-backup-codes',
      ]),
    );
    expect(plugin.hooks.after[0].matcher({ path: '/sign-in/email' } as never)).toBe(true);
  });
});

import {
  decideRegistration,
  isSignupDisabledByEnv,
  registrationDenialMessage,
} from '@/lib/registration-policy';

describe('isSignupDisabledByEnv', () => {
  it('is false when DISABLE_AUTH is unset', () => {
    expect(isSignupDisabledByEnv({})).toBe(false);
  });

  it.each([
    '1',
    'true',
    'TRUE',
    'True',
    ' 1 ',
    ' true ',
    '\ttrue\n',
  ])('is true for DISABLE_AUTH=%p', (value) => {
    expect(isSignupDisabledByEnv({ DISABLE_AUTH: value })).toBe(true);
  });

  it.each(['0', 'false', 'FALSE', 'yes', '2', '', '  '])('is false for DISABLE_AUTH=%p', (value) => {
    expect(isSignupDisabledByEnv({ DISABLE_AUTH: value })).toBe(false);
  });
});

describe('decideRegistration', () => {
  describe('no invitation code supplied', () => {
    it('allows the very first user even when DISABLE_AUTH is set (bootstrap escape hatch)', () => {
      const decision = decideRegistration({
        isFirstUser: true,
        env: { DISABLE_AUTH: 'true' },
      });
      expect(decision).toEqual({ allowed: true });
    });

    it('allows any user when DISABLE_AUTH is unset (open signup)', () => {
      const decision = decideRegistration({
        isFirstUser: false,
        env: {},
      });
      expect(decision).toEqual({ allowed: true });
    });

    it('rejects a non-first user when DISABLE_AUTH is set', () => {
      const decision = decideRegistration({
        isFirstUser: false,
        env: { DISABLE_AUTH: '1' },
      });
      expect(decision).toEqual({ allowed: false, reason: 'signup_disabled' });
    });
  });

  describe('invitation code supplied', () => {
    it('allows a found, unused, unexpired code — even when DISABLE_AUTH is set', () => {
      const decision = decideRegistration({
        invitationCode: 'ABC123',
        invitation: { found: true, usedAt: null, expiresAt: null },
        isFirstUser: false,
        env: { DISABLE_AUTH: 'true' },
      });
      expect(decision).toEqual({ allowed: true });
    });

    it('rejects a code that does not exist, rather than falling back to open signup', () => {
      const decision = decideRegistration({
        invitationCode: 'DOES-NOT-EXIST',
        invitation: { found: false },
        isFirstUser: false,
        env: {},
      });
      expect(decision).toEqual({ allowed: false, reason: 'invalid_code' });
    });

    it('rejects an already-used code, rather than falling back to open signup', () => {
      const decision = decideRegistration({
        invitationCode: 'USED-CODE',
        invitation: { found: true, usedAt: new Date('2020-01-01'), expiresAt: null },
        isFirstUser: false,
        env: {},
      });
      expect(decision).toEqual({ allowed: false, reason: 'already_used_code' });
    });

    it('rejects an expired code, rather than falling back to open signup', () => {
      const decision = decideRegistration({
        invitationCode: 'EXPIRED-CODE',
        invitation: { found: true, usedAt: null, expiresAt: new Date('2020-01-01') },
        isFirstUser: false,
        env: {},
        now: new Date('2026-01-01'),
      });
      expect(decision).toEqual({ allowed: false, reason: 'expired_code' });
    });

    it('accepts a code whose expiry is still in the future', () => {
      const decision = decideRegistration({
        invitationCode: 'STILL-VALID',
        invitation: { found: true, usedAt: null, expiresAt: new Date('2030-01-01') },
        isFirstUser: false,
        env: {},
        now: new Date('2026-01-01'),
      });
      expect(decision).toEqual({ allowed: true });
    });

    it('validates a supplied code even for the very first user, instead of always bootstrapping', () => {
      const decision = decideRegistration({
        invitationCode: 'BOGUS',
        invitation: { found: false },
        isFirstUser: true,
        env: {},
      });
      expect(decision).toEqual({ allowed: false, reason: 'invalid_code' });
    });
  });
});

describe('registrationDenialMessage', () => {
  it('gives a distinct, non-generic message per reason', () => {
    const messages = [
      registrationDenialMessage('invalid_code'),
      registrationDenialMessage('already_used_code'),
      registrationDenialMessage('expired_code'),
      registrationDenialMessage('signup_disabled'),
    ];
    // All distinct — a caller must never see the same string for two different reasons.
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

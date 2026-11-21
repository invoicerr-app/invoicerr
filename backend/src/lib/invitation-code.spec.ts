import { createHash } from 'node:crypto';

import {
  INVITATION_CODE_PREFIX_LENGTH,
  hashInvitationCode,
  invitationCodePrefix,
  invitationCodesMatch,
} from './invitation-code';

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'unit-test-auth-secret';
  delete process.env.JWT_SECRET;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

describe('hashInvitationCode', () => {
  it('is deterministic for one deployment secret, so the lookup can be an equality query', () => {
    expect(hashInvitationCode('ABCD1234')).toBe(hashInvitationCode('ABCD1234'));
  });

  it('produces a 64-character lowercase hex digest', () => {
    expect(hashInvitationCode('ABCD1234')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed: it is not the unkeyed SHA-256 of the code, so a dump alone cannot be guessed offline', () => {
    const code = 'ABCD1234';
    expect(hashInvitationCode(code)).not.toBe(createHash('sha256').update(code).digest('hex'));
  });

  it('changes when the deployment secret changes, which invalidates stale digests on rotation', () => {
    const before = hashInvitationCode('ABCD1234');
    process.env.BETTER_AUTH_SECRET = 'a-different-secret';
    expect(hashInvitationCode('ABCD1234')).not.toBe(before);
  });

  it('falls back to JWT_SECRET when BETTER_AUTH_SECRET is unset, like lib/auth.ts', () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.JWT_SECRET = 'jwt-fallback-secret';
    const withFallback = hashInvitationCode('ABCD1234');

    process.env.BETTER_AUTH_SECRET = 'jwt-fallback-secret';
    delete process.env.JWT_SECRET;
    expect(hashInvitationCode('ABCD1234')).toBe(withFallback);
  });

  it('gives two different codes two different digests', () => {
    expect(hashInvitationCode('AAAAAAAA')).not.toBe(hashInvitationCode('AAAAAAAB'));
  });
});

describe('invitationCodePrefix', () => {
  it('keeps exactly the eight leading characters the settings screen previews', () => {
    expect(invitationCodePrefix('0123456789ABCDEF')).toBe('01234567');
    expect(INVITATION_CODE_PREFIX_LENGTH).toBe(8);
  });
});

describe('invitationCodesMatch', () => {
  it('accepts the code that produced the stored digest', () => {
    expect(invitationCodesMatch('ABCD1234', hashInvitationCode('ABCD1234'))).toBe(true);
  });

  it('rejects a different code', () => {
    expect(invitationCodesMatch('ABCD1235', hashInvitationCode('ABCD1234'))).toBe(false);
  });

  it('rejects a stored value of a different length without throwing', () => {
    expect(invitationCodesMatch('ABCD1234', 'not-a-digest')).toBe(false);
  });
});

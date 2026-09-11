import * as crypto from 'node:crypto';

import {
  generateOtpCode,
  hashOtpCode,
  MAX_FAILED_ATTEMPTS,
  otpCodeMatches,
  OTP_CODE_SPACE,
  OTP_WINDOW_MS,
} from './otp';

describe('otp — CSPRNG, format, and the guarantee this whole feature exists to make true', () => {
  afterEach(() => jest.restoreAllMocks());

  it("never calls Math.random — the removed module's own GHSA-vhjw-gwc5-pjfp break", () => {
    const mathRandomSpy = jest.spyOn(Math, 'random');
    for (let i = 0; i < 200; i++) generateOtpCode();
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('calls crypto.randomInt over the full [0, OTP_CODE_SPACE) range, not a hand-rolled equivalent', () => {
    const randomIntSpy = jest.spyOn(crypto, 'randomInt');
    generateOtpCode();
    expect(randomIntSpy).toHaveBeenCalledWith(0, OTP_CODE_SPACE);
  });

  it('is always an 8-digit, zero-padded string — a small value reads as "00000005", never "5"', () => {
    jest.spyOn(crypto, 'randomInt').mockImplementation(() => 5);
    expect(generateOtpCode()).toBe('00000005');
  });

  it('never truncates the top of the range — the largest possible value stays 8 digits', () => {
    jest.spyOn(crypto, 'randomInt').mockImplementation(() => OTP_CODE_SPACE - 1);
    expect(generateOtpCode()).toBe('99999999');
    expect(generateOtpCode()).toHaveLength(8);
  });

  it('a fresh code looks like a real 8-digit code (format smoke test over many draws)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode()).toMatch(/^\d{8}$/);
    }
  });

  it("the OTP window is 5 minutes, down from the removed module's own 15", () => {
    expect(OTP_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it('hashes the code — never stores/compares it in the clear', () => {
    const code = '12345678';
    const digest = hashOtpCode(code);
    expect(digest).not.toBe(code);
    expect(digest).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    // Deterministic — the same code always hashes to the same digest (needed to compare against
    // what was stored), but the digest itself never round-trips back to the code.
    expect(hashOtpCode(code)).toBe(digest);
  });

  describe('otpCodeMatches — constant-time, well-formed-only comparison', () => {
    it('calls crypto.timingSafeEqual — never a hand-rolled === on the digests', () => {
      const timingSafeEqualSpy = jest.spyOn(crypto, 'timingSafeEqual');
      const stored = hashOtpCode('12345678');
      otpCodeMatches('12345678', stored);
      expect(timingSafeEqualSpy).toHaveBeenCalled();
    });

    it('true for the exact code that was hashed', () => {
      const stored = hashOtpCode('87654321');
      expect(otpCodeMatches('87654321', stored)).toBe(true);
    });

    it('false for a different, equally well-formed code', () => {
      const stored = hashOtpCode('87654321');
      expect(otpCodeMatches('87654320', stored)).toBe(false);
    });

    it('false (never throws) for a malformed candidate — short, long, or non-digit', () => {
      const stored = hashOtpCode('12345678');
      expect(otpCodeMatches('1234567', stored)).toBe(false);
      expect(otpCodeMatches('123456789', stored)).toBe(false);
      expect(otpCodeMatches('abcdefgh', stored)).toBe(false);
      expect(otpCodeMatches('', stored)).toBe(false);
    });
  });

  describe('the guarantee', () => {
    /**
     * THE security requirement, encoded so it cannot silently regress: recomputed from the two real,
     * exported constants (never a copy-pasted "5" and "100000000" that could drift from the actual
     * values) — bumping MAX_FAILED_ATTEMPTS up, or shrinking OTP_CODE_SPACE down, fails this test and
     * therefore CI. The ceiling is 0.01% (0.0001); the actual figure is 0.000005%.
     */
    it('MAX_FAILED_ATTEMPTS / OTP_CODE_SPACE never exceeds 0.01% (0.0001)', () => {
      const fraction = MAX_FAILED_ATTEMPTS / OTP_CODE_SPACE;
      expect(fraction).toBeLessThanOrEqual(0.0001);
      // Pinned to the actual, current figure too — 5 / 10^8 = 0.000005% — so a change to either
      // constant is visible here even while it still technically clears the 0.01% ceiling above.
      expect(fraction).toBe(0.00000005);
    });

    it('the code space is exactly 10^8 (8 digits) — never silently narrowed', () => {
      expect(OTP_CODE_SPACE).toBe(100_000_000);
    });
  });
});

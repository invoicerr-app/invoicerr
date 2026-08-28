/**
 * P1-T05 (A5) — PPF rule G1.05, DSE Annexe 7 v1.9.
 *
 * At most 35 characters; the only special characters allowed are space, `-`, `+`, `_`, `/`; no
 * leading space, no trailing space, no consecutive spaces.
 *
 * The boundary cases are the point: 35 accepted and 36 refused, each permitted special accepted
 * individually, and each of the three space rules refused on its own. A guard that only rejects
 * obviously-bad input passes review and lets the real cases through.
 */
import { violatesG105 } from './numbering';

describe('G1.05 — invoice number format', () => {
  describe('accepts', () => {
    it.each([
      ['plain alphanumeric', 'FA2026000123'],
      ['exactly 35 characters', 'A'.repeat(35)],
      ['a single space', 'FA 2026 000123'],
      ['hyphen', 'FA-2026-000123'],
      ['plus', 'FA+2026'],
      ['underscore', 'FA_2026_000123'],
      ['slash', 'FA/2026/000123'],
      ['all five specials at once', 'FA-2026+01_02/03 04'],
      ['empty string', ''],
    ])('%s', (_label, value) => {
      expect(violatesG105(value)).toBeNull();
    });
  });

  describe('refuses', () => {
    it('36 characters — one past the boundary', () => {
      expect(violatesG105('A'.repeat(36))).toBe('36 characters, maximum is 35');
    });

    it.each([
      ['a dot', 'FA.2026', '"."'],
      ['a comma', 'FA,2026', '","'],
      ['an asterisk', 'FA*2026', '"*"'],
      ['an accent', 'FAÉ2026', '"É"'],
      ['a colon', 'FA:2026', '":"'],
    ])('%s', (_label, value, quoted) => {
      const violation = violatesG105(value);
      expect(violation).toContain('forbidden character');
      expect(violation).toContain(quoted);
    });

    it('a leading space', () => {
      expect(violatesG105(' FA2026')).toBe('leading space');
    });

    it('a trailing space', () => {
      expect(violatesG105('FA2026 ')).toBe('trailing space');
    });

    it('consecutive spaces', () => {
      expect(violatesG105('FA  2026')).toBe('consecutive spaces');
    });
  });

  it('reports length before character content, so the message names the first thing to fix', () => {
    // A 40-character string that ALSO contains a dot: the length is what the user must fix first,
    // and a guard that reported the dot would send them to edit the wrong end of the pattern.
    expect(violatesG105(`${'A'.repeat(39)}.`)).toBe('40 characters, maximum is 35');
  });
});

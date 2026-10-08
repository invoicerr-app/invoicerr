import { SUGGESTED_UNIT_CODES, unitCodeFor } from './unit-code';

describe('unitCodeFor', () => {
  it.each([
    ['day', 'DAY'],
    ['Hours', 'HUR'],
    ['kg', 'KGM'],
    ['piece', 'C62'],
    ['box', 'BX'],
  ])('maps the legacy English word %s to %s', (word, code) => {
    expect(unitCodeFor(word)).toBe(code);
  });

  it.each(SUGGESTED_UNIT_CODES)('passes the suggested Rec20 code %s through unchanged', (code) => {
    expect(unitCodeFor(code)).toBe(code);
    expect(unitCodeFor(`  ${code} `)).toBe(code);
  });

  it('falls back to C62 only for text it does not know', () => {
    expect(unitCodeFor('sprint')).toBe('C62');
    expect(unitCodeFor('')).toBe('C62');
  });
});

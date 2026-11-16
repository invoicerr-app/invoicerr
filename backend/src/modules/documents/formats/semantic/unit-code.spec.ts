import { SUGGESTED_UNIT_CODES, UNAMBIGUOUS_UNIT_WORDS, knownUnitCode, unitCodeFor } from './unit-code';

describe('unitCodeFor', () => {
  // Stored text exports exactly as it did before units became codes, so an issued invoice's XML
  // never changes: these are the outputs of the previous mapping.
  it.each([
    ['day', 'DAY'],
    ['Hours', 'HUR'],
    ['kg', 'KGM'],
    ['piece', 'C62'],
    ['pieces', 'C62'],
    ['unit', 'C62'],
    ['m', 'MTR'],
    ['l', 'LTR'],
    ['g', 'GRM'],
    ['km', 'KMT'],
    ['box', 'BX'],
    ['set', 'SET'],
    ['h', 'C62'],
    ['Stunde', 'C62'],
    ['szt.', 'C62'],
  ])('exports the stored text %s as %s, as before', (text, code) => {
    expect(unitCodeFor(text)).toBe(code);
  });

  it.each([
    ['h', 'HUR'],
    ['Stunde', 'HUR'],
    ['szt.', 'H87'],
    ['piece', 'H87'],
  ])('recognises the unambiguous word %s as %s for the migration', (word, code) => {
    expect(knownUnitCode(word)).toBe(code);
  });

  it.each(SUGGESTED_UNIT_CODES)('passes the suggested Rec20 code %s through unchanged', (code) => {
    expect(unitCodeFor(code)).toBe(code);
    expect(unitCodeFor(`  ${code} `)).toBe(code);
  });

  it.each(['sprint', 'lot', 'forfait', ''])('exports the free text "%s" as C62', (text) => {
    expect(knownUnitCode(text)).toBeUndefined();
    expect(unitCodeFor(text)).toBe('C62');
  });

  it.each(['m', 'lata', 'tag', 'pc', 'std', 'satz', 'ora'])(
    'leaves the ambiguous word "%s" as free text',
    (word) => {
      expect(knownUnitCode(word)).toBeUndefined();
    },
  );

  it('never lists one word under two codes', () => {
    const words = Object.values(UNAMBIGUOUS_UNIT_WORDS).flat();
    expect(new Set(words).size).toBe(words.length);
  });
});

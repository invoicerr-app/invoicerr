import { guessCountryCode } from './country-name-to-iso';

describe('guessCountryCode', () => {
  it('returns undefined for null/undefined/empty input', () => {
    expect(guessCountryCode(null)).toBeUndefined();
    expect(guessCountryCode(undefined)).toBeUndefined();
    expect(guessCountryCode('')).toBeUndefined();
    expect(guessCountryCode('   ')).toBeUndefined();
  });

  it('passthrough for already-valid 2-letter codes', () => {
    expect(guessCountryCode('FR')).toBe('FR');
    expect(guessCountryCode('de')).toBe('DE');
    expect(guessCountryCode('GB')).toBe('GB');
    expect(guessCountryCode('us')).toBe('US');
  });

  it('resolves English country names', () => {
    expect(guessCountryCode('France')).toBe('FR');
    expect(guessCountryCode('GERMANY')).toBe('DE');
    expect(guessCountryCode('united kingdom')).toBe('GB');
    expect(guessCountryCode('United States')).toBe('US');
    expect(guessCountryCode('Spain')).toBe('ES');
    expect(guessCountryCode('Italy')).toBe('IT');
    expect(guessCountryCode('Belgium')).toBe('BE');
    expect(guessCountryCode('Switzerland')).toBe('CH');
    expect(guessCountryCode('Canada')).toBe('CA');
    expect(guessCountryCode('Netherlands')).toBe('NL');
    expect(guessCountryCode('Luxembourg')).toBe('LU');
  });

  it('resolves French country names', () => {
    expect(guessCountryCode('Allemagne')).toBe('DE');
    expect(guessCountryCode('États-Unis')).toBe('US');
    expect(guessCountryCode('Etats-Unis')).toBe('US');
    expect(guessCountryCode('Royaume-Uni')).toBe('GB');
    expect(guessCountryCode('Espagne')).toBe('ES');
    expect(guessCountryCode('Italie')).toBe('IT');
    expect(guessCountryCode('Belgique')).toBe('BE');
    expect(guessCountryCode('Suisse')).toBe('CH');
    expect(guessCountryCode('Pays-Bas')).toBe('NL');
  });

  it('returns undefined for unrecognized country names', () => {
    expect(guessCountryCode('Test Country')).toBeUndefined();
    expect(guessCountryCode('Atlantis')).toBeUndefined();
    expect(guessCountryCode('Westeros')).toBeUndefined();
  });

  it('handles case-insensitive matching', () => {
    expect(guessCountryCode('fRANCE')).toBe('FR'); // mixed case
    expect(guessCountryCode('GERMANY')).toBe('DE');
    expect(guessCountryCode('italy')).toBe('IT');
  });

  it('resolves common abbreviations', () => {
    expect(guessCountryCode('USA')).toBe('US');
    expect(guessCountryCode('UK')).toBe('GB'); // alias in the map
    expect(guessCountryCode('UAE')).toBe('AE');
    expect(guessCountryCode('DEU')).toBe('DE');
  });

  it('trims whitespace', () => {
    expect(guessCountryCode('  France  ')).toBe('FR');
    expect(guessCountryCode('  DE  ')).toBe('DE');
  });

  it('resolves e2e fixture country values', () => {
    expect(guessCountryCode('France')).toBe('FR');
    expect(guessCountryCode('USA')).toBe('US');
    expect(guessCountryCode('Germany')).toBe('DE');
    expect(guessCountryCode('United Kingdom')).toBe('GB');
    expect(guessCountryCode('Test Country')).toBeUndefined();
  });
});

import { PartyTaxProfile } from '../canonical/canonical-document';
import { TrustFlagVatValidator, selectorMatches, taxUnionOf } from './classification';

describe('taxUnionOf', () => {
  it('classifies EU members', () => {
    expect(taxUnionOf('FR')).toBe('EU');
    expect(taxUnionOf('de')).toBe('EU'); // case-insensitive
    expect(taxUnionOf('IT')).toBe('EU');
  });
  it('classifies GCC members', () => {
    expect(taxUnionOf('SA')).toBe('GCC');
    expect(taxUnionOf('AE')).toBe('GCC');
  });
  it('returns null for countries in no modelled union', () => {
    expect(taxUnionOf('US')).toBeNull();
    expect(taxUnionOf('MX')).toBeNull();
    expect(taxUnionOf('')).toBeNull();
  });
});

describe('selectorMatches', () => {
  it('treats an undefined selector as a wildcard', () => {
    expect(selectorMatches(undefined, 'B2C', ['GOODS'])).toBe(true);
  });
  it('matches on role', () => {
    expect(selectorMatches({ roles: ['B2B', 'B2G'] }, 'B2B', ['SERVICES'])).toBe(true);
    expect(selectorMatches({ roles: ['B2B', 'B2G'] }, 'B2C', ['SERVICES'])).toBe(false);
  });
  it('matches when any line supply type is in the selector', () => {
    expect(selectorMatches({ supply: ['GOODS'] }, 'B2B', ['SERVICES', 'GOODS'])).toBe(true);
    expect(selectorMatches({ supply: ['GOODS'] }, 'B2B', ['SERVICES'])).toBe(false);
  });
  it('requires both role and supply to match when both are set', () => {
    expect(selectorMatches({ roles: ['B2C'], supply: ['DIGITAL'] }, 'B2C', ['DIGITAL'])).toBe(true);
    expect(selectorMatches({ roles: ['B2C'], supply: ['DIGITAL'] }, 'B2C', ['GOODS'])).toBe(false);
  });
});

describe('TrustFlagVatValidator (conservative default)', () => {
  const v = new TrustFlagVatValidator();
  const make = (validated?: boolean, scheme = 'VAT'): PartyTaxProfile => ({
    legalName: 'X',
    countryCode: 'IT',
    role: 'B2B',
    identifiers: [{ scheme, value: 'IT123', validated }],
  });

  it('is valid only when the VAT id is explicitly validated', () => {
    expect(v.hasValidVat(make(true))).toBe(true);
  });
  it('is NOT valid when unchecked, invalid, or absent (never under-charges tax)', () => {
    expect(v.hasValidVat(make(undefined))).toBe(false);
    expect(v.hasValidVat(make(false))).toBe(false);
    expect(v.hasValidVat({ legalName: 'X', countryCode: 'IT', role: 'B2B', identifiers: [] })).toBe(false);
    expect(v.hasValidVat(make(true, 'SIREN'))).toBe(false); // not a VAT scheme
  });
});

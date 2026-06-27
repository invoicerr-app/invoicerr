/** Complements tax-engine.spec.ts: GCC union, GST domestic, NONE supplier, OSS with a real buyer
 *  profile, exempt/zero schemes, and the classification helpers. */
import { DocumentLine, PartyTaxProfile } from '../canonical/canonical-document';
import { PartyRole, SupplyType, TaxScheme } from '../types';
import { FR } from '../profiles/data/fr';
import { IT } from '../profiles/data/it';
import { defaultRegistry } from '../profiles/registry';
import { selectorMatches, taxUnionOf, TrustFlagVatValidator } from './classification';
import { determineLineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultRegistry.resolve(cc).profile;

function party(country: string, role: PartyRole, o: { scheme?: TaxScheme; valid?: boolean } = {}): PartyTaxProfile {
  const validated = o.valid ?? role === 'B2B';
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    taxScheme: o.scheme,
    identifiers: role === 'B2C' && o.valid === undefined ? [] : [{ scheme: 'VAT', value: `${country}1`, validated }],
  };
}
const line = (supplyType: SupplyType, taxCategoryHint?: 'Z'): DocumentLine => ({ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType, taxCategoryHint });

describe('TaxEngine — GCC union', () => {
  it('SA→AE B2B services (both GCC, valid VAT): reverse charge', () => {
    const t = determineLineTax(party('SA', 'B2B'), party('AE', 'B2B'), line('SERVICES'), prof('SA'), vat, prof('AE'));
    expect(t.components[0].category).toBe('AE');
    expect(t.buyerSelfAssess).toBe(true);
  });
  it('SA→AE B2B goods: intra-union supply (K)', () => {
    const t = determineLineTax(party('SA', 'B2B'), party('AE', 'B2B'), line('GOODS'), prof('SA'), vat, prof('AE'));
    expect(t.components[0].category).toBe('K');
  });
});

describe('TaxEngine — GST & NONE systems', () => {
  it('IN→IN domestic (GST): standard 18%', () => {
    const t = determineLineTax(party('IN', 'B2B'), party('IN', 'B2B'), line('GOODS'), prof('IN'), vat, prof('IN'));
    expect(t.components[0].taxSystem).toBe('GST');
    expect(t.components[0].rate).toBe(18);
    expect(t.components[0].category).toBe('S');
  });
  it('a NONE-tax supplier (Qatar) emits an out-of-scope component', () => {
    const t = determineLineTax(party('QA', 'B2B'), party('QA', 'B2C'), line('GOODS'), prof('QA'), vat, prof('QA'));
    expect(t.components[0].taxSystem).toBe('NONE');
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
  });
});

describe('TaxEngine — OSS destination rate from a real buyer profile', () => {
  it('FR→IT B2C goods: OSS charges IT standard rate (22%) in IT', () => {
    const t = determineLineTax(party('FR', 'B2C'), party('IT', 'B2C'), line('GOODS'), FR, vat, IT);
    expect(t.components[0].jurisdiction).toBe('IT');
    expect(t.components[0].rate).toBe(22);
    expect(t.reportingFlags).toContain('OSS');
  });
});

describe('TaxEngine — schemes & zero rating', () => {
  it('EXEMPT scheme: category E, 0%, no franchise mention', () => {
    const t = determineLineTax(party('FR', 'B2B', { scheme: 'EXEMPT' }), party('FR', 'B2C'), line('SERVICES'), FR, vat, FR);
    expect(t.components[0].category).toBe('E');
    expect(t.mentions).toHaveLength(0);
  });
  it('a zero-rated line hint (Z): 0%, category Z', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('FR', 'B2B'), line('GOODS', 'Z'), FR, vat, FR);
    expect(t.components[0].rate).toBe(0);
    expect(t.components[0].category).toBe('Z');
  });
});

describe('classification helpers', () => {
  it('taxUnionOf maps EU / GCC / none', () => {
    expect(taxUnionOf('FR')).toBe('EU');
    expect(taxUnionOf('SA')).toBe('GCC');
    expect(taxUnionOf('US')).toBeNull();
    expect(taxUnionOf('')).toBeNull();
  });
  it('TrustFlagVatValidator only trusts an explicitly-validated VAT id', () => {
    const v = new TrustFlagVatValidator();
    expect(v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x', validated: true }] } as PartyTaxProfile)).toBe(true);
    expect(v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x', validated: false }] } as PartyTaxProfile)).toBe(false);
    expect(v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x' }] } as PartyTaxProfile)).toBe(false);
    expect(v.hasValidVat({ identifiers: [] } as unknown as PartyTaxProfile)).toBe(false);
  });
  it('selectorMatches respects roles and supply types', () => {
    expect(selectorMatches(undefined, 'B2B', ['GOODS'])).toBe(true);
    expect(selectorMatches({ roles: ['B2B'] }, 'B2B', ['GOODS'])).toBe(true);
    expect(selectorMatches({ roles: ['B2C'] }, 'B2B', ['GOODS'])).toBe(false);
    expect(selectorMatches({ supply: ['SERVICES'] }, 'B2B', ['GOODS'])).toBe(false);
    expect(selectorMatches({ supply: ['SERVICES'] }, 'B2B', ['GOODS', 'SERVICES'])).toBe(true);
  });
});

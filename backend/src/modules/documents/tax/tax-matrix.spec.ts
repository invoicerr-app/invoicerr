/**
 * LA MATRICE — reprise, adaptée, des DIX cas de `compliance/engine/tax-matrix.spec.ts` (git tag
 * `avant-refonte-documents`): GCC union, GST domestic, un fournisseur NONE, l'OSS avec un vrai profil
 * acheteur, les régimes exempt/zéro, et les deux helpers de classification. Seuls les imports
 * changent (types/`../tax-systems/registry` de ce module plutôt que les profils pays complets
 * supprimés) — chaque assertion est CHIFFRÉE (root TODO item 16's own test brief), pas seulement
 * qualitative, là où le repère ne l'était pas déjà.
 */
import { DocumentLine, PartyTaxProfile, SupplyType, TaxScheme } from './types';
import { defaultTaxSystemRegistry } from './tax-systems/registry';
import { selectorMatches, taxUnionOf, TrustFlagVatValidator } from './classification';
import { determineLineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultTaxSystemRegistry.resolve(cc)!;

function party(
  country: string,
  role: PartyTaxProfile['role'],
  o: { scheme?: TaxScheme; valid?: boolean } = {},
): PartyTaxProfile {
  const validated = o.valid ?? role === 'B2B';
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    taxScheme: o.scheme,
    identifiers:
      role === 'B2C' && o.valid === undefined ? [] : [{ scheme: 'VAT', value: `${country}1`, validated }],
  };
}
const line = (supplyType: SupplyType, taxCategoryHint?: 'Z'): DocumentLine => ({
  id: 'l1',
  description: 'x',
  quantity: 1,
  unitNetMinor: 10000,
  supplyType,
  taxCategoryHint,
});

describe('LA MATRICE — TaxEngine — GCC union', () => {
  it('1. SA→AE B2B services (both GCC, valid VAT): reverse charge (0%, category AE)', () => {
    const t = determineLineTax(
      party('SA', 'B2B'),
      party('AE', 'B2B'),
      line('SERVICES'),
      prof('SA'),
      vat,
      prof('AE'),
    );
    expect(t.components[0].category).toBe('AE');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
  });
  it('2. SA→AE B2B goods: intra-union supply (0%, category K)', () => {
    const t = determineLineTax(
      party('SA', 'B2B'),
      party('AE', 'B2B'),
      line('GOODS'),
      prof('SA'),
      vat,
      prof('AE'),
    );
    expect(t.components[0].category).toBe('K');
    expect(t.components[0].rate).toBe(0);
  });
});

describe('LA MATRICE — TaxEngine — GST & NONE systems', () => {
  it('3. IN→IN domestic (GST): standard 18%, category S', () => {
    const t = determineLineTax(
      party('IN', 'B2B'),
      party('IN', 'B2B'),
      line('GOODS'),
      prof('IN'),
      vat,
      prof('IN'),
    );
    expect(t.components[0].taxSystem).toBe('GST');
    expect(t.components[0].rate).toBe(18);
    expect(t.components[0].category).toBe('S');
  });
  it('4. a NONE-tax supplier (Qatar) emits an out-of-scope component (0%, category O)', () => {
    const t = determineLineTax(
      party('QA', 'B2B'),
      party('QA', 'B2C'),
      line('GOODS'),
      prof('QA'),
      vat,
      prof('QA'),
    );
    expect(t.components[0].taxSystem).toBe('NONE');
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
  });
});

describe('LA MATRICE — TaxEngine — OSS destination rate from a real buyer profile', () => {
  it('5. FR→IT B2C goods: OSS charges the real IT standard rate (22%) in IT', () => {
    const t = determineLineTax(
      party('FR', 'B2C'),
      party('IT', 'B2C'),
      line('GOODS'),
      prof('FR'),
      vat,
      prof('IT'),
    );
    expect(t.components[0].jurisdiction).toBe('IT');
    expect(t.components[0].rate).toBe(22);
    expect(t.reportingFlags).toContain('OSS');
  });
});

describe('LA MATRICE — TaxEngine — schemes & zero rating', () => {
  it('6. EXEMPT scheme: category E, 0%, no franchise mention', () => {
    const t = determineLineTax(
      party('FR', 'B2B', { scheme: 'EXEMPT' }),
      party('FR', 'B2C'),
      line('SERVICES'),
      prof('FR'),
      vat,
      prof('FR'),
    );
    expect(t.components[0].category).toBe('E');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions).toHaveLength(0);
  });
  it('7. a zero-rated line hint (Z): 0%, category Z', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('FR', 'B2B'),
      line('GOODS', 'Z'),
      prof('FR'),
      vat,
      prof('FR'),
    );
    expect(t.components[0].rate).toBe(0);
    expect(t.components[0].category).toBe('Z');
  });
});

describe('LA MATRICE — classification helpers', () => {
  it('8. taxUnionOf maps EU / GCC / none', () => {
    expect(taxUnionOf('FR')).toBe('EU');
    expect(taxUnionOf('SA')).toBe('GCC');
    expect(taxUnionOf('US')).toBeNull();
    expect(taxUnionOf('')).toBeNull();
  });
  it('9. TrustFlagVatValidator only trusts an explicitly-validated VAT id', () => {
    const v = new TrustFlagVatValidator();
    expect(
      v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x', validated: true }] } as PartyTaxProfile),
    ).toBe(true);
    expect(
      v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x', validated: false }] } as PartyTaxProfile),
    ).toBe(false);
    expect(v.hasValidVat({ identifiers: [{ scheme: 'VAT', value: 'x' }] } as PartyTaxProfile)).toBe(false);
    expect(v.hasValidVat({ identifiers: [] } as unknown as PartyTaxProfile)).toBe(false);
  });
  it('10. selectorMatches respects roles and supply types', () => {
    expect(selectorMatches(undefined, 'B2B', ['GOODS'])).toBe(true);
    expect(selectorMatches({ roles: ['B2B'] }, 'B2B', ['GOODS'])).toBe(true);
    expect(selectorMatches({ roles: ['B2C'] }, 'B2B', ['GOODS'])).toBe(false);
    expect(selectorMatches({ supply: ['SERVICES'] }, 'B2B', ['GOODS'])).toBe(false);
    expect(selectorMatches({ supply: ['SERVICES'] }, 'B2B', ['GOODS', 'SERVICES'])).toBe(true);
  });
});

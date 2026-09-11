/**
 * LA MATRICE — reprise, adaptée, des DIX cas de `compliance/engine/tax-matrix.spec.ts` (git tag
 * `avant-refonte-documents`): GCC union, GST domestic, un fournisseur NONE, l'OSS avec un vrai profil
 * acheteur, les régimes exempt/zéro, et les deux helpers de classification. Seuls les imports
 * changent (types/`../tax-systems/registry` de ce module plutôt que les profils pays complets
 * supprimés) — chaque assertion est CHIFFRÉE, pas seulement
 * qualitative, là où le repère ne l'était pas déjà.
 *
 * Re-anchored by the 5-country prune (2026-09-10): SA/AE/IN/QA/HU's own
 * `tax-systems/data/xx.json` files were removed along with every country outside FR/PL/IT/PT/DE. The
 * GCC-union, GST-domestic and NONE-tax-system cases below test GENERIC, data-driven dispatch in
 * `tax-engine.ts`/`classification.ts` (never a per-country branch — `EU_MEMBERS`/`GCC_VAT` in
 * classification.ts stay complete, untouched tables) that remains fully reachable by any directly
 * -constructed `CountryTaxSystemProfile`, so these cases are re-anchored on HAND-BUILT synthetic
 * profiles (`saProfile`/`aeProfile`/`inProfile`/`qaProfile` below) instead of the removed registry
 * entries — this is a stronger test than before (independent of which countries happen to be
 * shipped), not a weaker one. The OSS "highest EU rate" case (was FR→HU, 27%) is re-anchored on
 * FR→PL (23%, tied for the highest among the KEPT countries — see tax-systems/data/all.spec.ts's own
 * matching claim).
 */
import { CountryTaxSystemProfile, DocumentLine, PartyTaxProfile, SupplyType, TaxScheme } from './types';
import { defaultTaxSystemRegistry } from './tax-systems/registry';
import { selectorMatches, taxUnionOf, TrustFlagVatValidator } from './classification';
import { determineLineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultTaxSystemRegistry.resolve(cc)!;

// Synthetic profiles for the GCC/GST/NONE mechanics — SA/AE/IN/QA's own shipped data files were
// removed by the 5-country prune, but the engine branches they exercise are generic (dispatch on
// `taxSystem.kind`, never a per-country special case), so these hand-built fixtures keep the same
// mechanical coverage without depending on any shipped country file. Values are plain test fixtures,
// not a legal claim about SA/AE/IN/QA's real tax law (unlike the sourced `tax-systems/data/*.json`
// catalog, which is never re-created here).
const saProfile: CountryTaxSystemProfile = {
  countryCode: 'SA',
  taxSystem: { kind: 'VAT', standardRate: 15, reducedRates: [], schemes: ['STANDARD'] },
};
const aeProfile: CountryTaxSystemProfile = {
  countryCode: 'AE',
  taxSystem: { kind: 'VAT', standardRate: 5, reducedRates: [], schemes: ['STANDARD'] },
};
const inProfile: CountryTaxSystemProfile = {
  countryCode: 'IN',
  taxSystem: { kind: 'GST', standardRate: 18, reducedRates: [], schemes: ['STANDARD'] },
};
const qaProfile: CountryTaxSystemProfile = { countryCode: 'QA', taxSystem: { kind: 'NONE' } };

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
      saProfile,
      vat,
      aeProfile,
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
      saProfile,
      vat,
      aeProfile,
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
      inProfile,
      vat,
      inProfile,
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
      qaProfile,
      vat,
      qaProfile,
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

  // The EU member states' standard rate, read from the
  // European Commission's TEDB. HU (27%, the highest in the full EU) was removed by the 5-country
  // prune (2026-09-10) — re-anchored on PL, tied for the highest standard rate among the KEPT
  // countries (23%, same as PT — see tax-systems/data/all.spec.ts's own matching claim).
  it('11. FR→PL B2C goods: OSS charges the real PL standard rate (23%, tied for the highest among the kept countries)', () => {
    const t = determineLineTax(
      party('FR', 'B2C'),
      party('PL', 'B2C'),
      line('GOODS'),
      prof('FR'),
      vat,
      prof('PL'),
    );
    expect(t.components[0].jurisdiction).toBe('PL');
    expect(t.components[0].rate).toBe(23);
    expect(t.components[0].category).toBe('S');
    expect(t.reportingFlags).toContain('OSS');
  });

  it('12. FR→DE B2C goods: OSS charges the real DE standard rate (19%) — DE used to be the gate’s own textbook missing-table example', () => {
    const t = determineLineTax(
      party('FR', 'B2C'),
      party('DE', 'B2C'),
      line('GOODS'),
      prof('FR'),
      vat,
      prof('DE'),
    );
    expect(t.components[0].jurisdiction).toBe('DE');
    expect(t.components[0].rate).toBe(19);
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

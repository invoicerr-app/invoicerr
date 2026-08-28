/**
 * The two rate-to-category derivations, and what replaced them.
 *
 * A 0 rate is the one value that does NOT determine its EN 16931 category. `Z`, `E` and `O` all
 * carry it and demand contradictory things of the document, so deriving the category FROM the rate
 * — which both sites did — is a guess wearing a derivation's clothes. These tests pin the guess
 * down to the one fact that can settle it: whether the country levies a zero rate at all.
 *
 * Every assertion here fails on the pre-change tree, where a 0 domestic rate was `Z` everywhere and
 * a nexus state with no sales tax was `Z` too.
 */
import { DocumentLine, PartyTaxProfile } from '../canonical/canonical-document';
import { CountryComplianceProfile, VatSystemSpec } from '../profiles/schema';
import { FR } from '../profiles/data/fr';
import { PL } from '../profiles/data/pl';
import { defaultRegistry } from '../profiles/registry';
import { TaxCategoryCode } from '../types';
import { resolveInvoiceTax } from '../integration/invoice-tax';
import { TrustFlagVatValidator } from './classification';
import { determineLineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultRegistry.resolve(cc).profile;

const usAddress = (subdivision: string) => ({
  line1: '1 Main St',
  postalCode: '00000',
  city: 'Somewhere',
  countryCode: 'US',
  subdivision,
});

function party(country: string): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role: 'B2B',
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

const line = (taxRateHint?: number, taxCategoryHint?: TaxCategoryCode): DocumentLine => ({
  id: 'l1',
  description: 'x',
  quantity: 1,
  unitNetMinor: 10000,
  supplyType: 'SERVICES',
  taxRateHint,
  taxCategoryHint,
});

/** A country profile with its zero-rate fact overridden, to exercise all three states of it. */
function withZeroRate(
  base: CountryComplianceProfile,
  hasDomesticZeroRate: boolean | undefined,
): CountryComplianceProfile {
  return {
    ...base,
    taxSystem: { ...(base.taxSystem as VatSystemSpec), hasDomesticZeroRate },
  };
}

const categoryOf = (supplier: CountryComplianceProfile, l: DocumentLine, cc: string) =>
  determineLineTax(party(cc), party(cc), l, supplier, vat, supplier).components[0].category;

describe('domestic category — the country decides, the rate cannot', () => {
  it('a country with NO zero rate does not answer Z: France returns E', () => {
    // The defect in one line. France levies no 0% rate (art. 278 ter, the only one, abrogated
    // 2023-01-01), so a 0% French domestic line was never a zero-rated supply — yet that is what
    // the engine called it, and what the document then claimed.
    expect(categoryOf(FR, line(0), 'FR')).toBe('E');
  });

  it('a country WITH a zero rate still answers Z: Poland returns Z', () => {
    // The other side, and why this cannot be a blanket rule. Poland genuinely levies 0% — its own
    // profile has said so all along by listing 0 in `reducedRates`.
    expect(categoryOf(PL, line(0), 'PL')).toBe('Z');
  });

  it('an UNSOURCED country keeps the previous answer rather than being reclassified', () => {
    // ~100 archetype profiles do not declare the fact. Absence of a declaration is not a
    // declaration of absence, so they must not be swept into E on the strength of a missing field.
    const unsourced = withZeroRate(FR, undefined);
    expect(unsourced.taxSystem.kind).toBe('VAT');
    expect(categoryOf(unsourced, line(0), 'FR')).toBe('Z');
  });

  it('the fact only governs the 0 case — a positive rate is S either way', () => {
    // `S` covers the standard rate AND every reduced rate: BT-152 carries the rate, BT-151 only
    // says which regime it belongs to. The `rate > 0` half of the old expression was already right
    // and this pins it so a future change does not "fix" it into something else.
    for (const rate of [20, 10, 5.5, 2.1]) {
      expect(categoryOf(FR, line(rate), 'FR')).toBe('S');
      expect(categoryOf(PL, line(rate), 'PL')).toBe('S');
    }
  });

  it('a declared category always wins over the derivation, in both directions', () => {
    // The seam that (c) fills. Until something writes `taxCategoryHint`, the `??` never fires in
    // production — which is exactly why the derivation had to be right on its own.
    expect(categoryOf(FR, line(0, 'O'), 'FR')).toBe('O');
    expect(categoryOf(FR, line(0, 'Z'), 'FR')).toBe('Z');
    expect(categoryOf(PL, line(0, 'E'), 'PL')).toBe('E');
  });

  it('every untaxed declared category forces the rate to 0, not just Z', () => {
    // The old guard read `taxCategoryHint === 'Z'` alone, so declaring E or O would have left the
    // standard rate in place — a line labelled "exempt" carrying 20%.
    for (const hint of ['Z', 'E', 'O'] as const) {
      const t = determineLineTax(party('FR'), party('FR'), line(undefined, hint), FR, vat, FR);
      expect(t.components[0].rate).toBe(0);
      expect(t.components[0].category).toBe(hint);
    }
  });

  it('a declared S is untouched and keeps its rate', () => {
    const t = determineLineTax(party('FR'), party('FR'), line(10, 'S'), FR, vat, FR);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(10);
  });
});

describe('sales tax — a 0 rate is out of scope, not zero-rated', () => {
  it('a nexus state that levies no sales tax returns O, not Z', () => {
    // Oregon, Montana, New Hampshire and Delaware: `us.ts` records them as "absent → 0". A seller
    // with nexus in one of them lands on the second derivation. `Z` is a VAT concept that does not
    // exist in a sales-tax system; the adjacent no-nexus branch already answers `O`.
    const us = prof('US');
    const buyer: PartyTaxProfile = { ...party('US'), address: usAddress('OR') };
    const supplier: PartyTaxProfile = { ...party('US'), address: usAddress('OR') };
    const withOregonNexus: CountryComplianceProfile = {
      ...us,
      taxSystem: { ...us.taxSystem, nexusSubdivisions: ['OR'] } as typeof us.taxSystem,
    };
    const t = determineLineTax(supplier, buyer, line(), withOregonNexus, vat, withOregonNexus);
    expect(t.components[0].rate).toBe(0);
    expect(t.components[0].category).toBe('O');
  });

  it('a nexus state that does levy it is still S', () => {
    const us = prof('US');
    const buyer: PartyTaxProfile = { ...party('US'), address: usAddress('CA') };
    const supplier: PartyTaxProfile = { ...party('US'), address: usAddress('CA') };
    const t = determineLineTax(supplier, buyer, line(), us, vat, us);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBeGreaterThan(0);
  });
});

/**
 * The chain, not the unit.
 *
 * Everything above exercises `determineLineTax` directly. That is where the defect lived, but it is
 * not where the product enters — `resolveInvoiceTax` is, and this repository has a documented habit
 * of correct seams wired to nothing (C4 shipped "ready" with no writer; `taxCategoryHint` still has
 * none). So the fix is asserted where an invoice actually arrives, at the value that gets persisted
 * on the line and read back by the renderer.
 */
describe('the invoice path carries the corrected category', () => {
  const invoice = (supplier: string, buyer: string, vatRate: number, role: 'B2B' | 'B2C' = 'B2B') =>
    resolveInvoiceTax({
      supplierCountryCode: supplier,
      supplierExemptVat: false,
      buyerCountryCode: buyer,
      buyerRole: role,
      currency: 'EUR',
      issueDate: new Date('2026-10-01'),
      discountRate: 0,
      items: [{ quantity: 1, unitPrice: 1000, vatRate, supplyType: 'SERVICES' }],
    });

  it('a French domestic 0% invoice is persisted as E, not Z', () => {
    const r = invoice('FR', 'FR', 0);
    expect(r.itemVatCategories).toEqual(['E']);
    expect(r.itemVatRates).toEqual([0]);
    expect(r.totalVAT).toBe(0);
  });

  it('the same invoice in Poland is still Z', () => {
    expect(invoice('PL', 'PL', 0).itemVatCategories).toEqual(['Z']);
  });

  it('an unsourced country is untouched — Germany still answers Z', () => {
    expect(invoice('DE', 'DE', 0).itemVatCategories).toEqual(['Z']);
  });

  it('B2C changes nothing: the zero-rate fact is about the country, not the buyer', () => {
    expect(invoice('FR', 'FR', 0, 'B2C').itemVatCategories).toEqual(['E']);
  });

  it('every out-of-scope path carries a reason — BR-O-10, and a US invoice must stay issuable', () => {
    // Regression, found by the country showcase and not by any unit test: the BR-E-10 / BR-O-10
    // issuance guard refuses category `O` without a reason, and three of the four `O` branches in
    // the engine set none. A domestic US invoice takes the no-nexus branch by default, so EVERY US
    // invoice had become unissuable — the same shape as the franchise-en-base near-miss, one
    // category over. The guard was right; the engine was silent.
    const us = invoice('US', 'US', 0);
    expect(us.itemVatCategories).toEqual(['O']);
    expect(us.itemVatExemptionReasons[0]).toBeTruthy();

    // The other two branches that were mute, reached from a supplier with no turnover tax at all
    // and from a cross-border sales-tax supply.
    const noTax = invoice('AE', 'AE', 0);
    expect(noTax.itemVatExemptionReasons.every((r, i) => noTax.itemVatCategories[i] !== 'O' || !!r)).toBe(
      true,
    );
    const usExport = invoice('US', 'FR', 0);
    expect(usExport.itemVatCategories).toEqual(['O']);
    expect(usExport.itemVatExemptionReasons[0]).toBeTruthy();
  });

  it('a French invoice at a real rate is untouched, category and amount', () => {
    const r = invoice('FR', 'FR', 20);
    expect(r.itemVatCategories).toEqual(['S']);
    expect(r.totalVAT).toBe(200);
  });
});

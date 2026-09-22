import { TaxSystemRegistry } from './registry';

describe('TaxSystemRegistry', () => {
  const registry = new TaxSystemRegistry();

  it('derives FR standardRate/reducedRates from vat-rates/ rather than duplicating them', () => {
    const fr = registry.resolve('FR');
    expect(fr?.taxSystem.kind).toBe('VAT');
    if (fr?.taxSystem.kind === 'VAT') {
      expect(fr.taxSystem.standardRate).toBe(20);
      expect(fr.taxSystem.reducedRates.sort((a, b) => b - a)).toEqual([10, 5.5, 2.1]);
      expect(fr.taxSystem.hasDomesticZeroRate).toBe(false);
    }
  });

  // US (SALES_TAX) and SA/AE/IN/QA (VAT/GST/NONE, non-EU) were removed by the 5-country prune
  // (2026-09-10) along with their data/xx.json — no kept country (DE/FR/IT/PL/PT) uses the
  // SALES_TAX/GST/NONE `kind`s, so these two cases have no honest re-anchor and are deleted rather
  // than weakened. `toTaxSystemSpec`'s own SALES_TAX/GST/NONE branches in registry.ts stay: they are
  // generic, data-driven dispatch on `fact.kind`, not a US/MX-specific branch, and remain reachable
  // by constructing a `TaxSystemRegistry` with a synthetic fact directly (see this file's own
  // constructor parameter).
  it('IT is resolvable with its own explicit rate', () => {
    expect(registry.resolve('IT')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 22 });
  });

  it('an uncatalogued country (the United Kingdom, GB — left the EU, no tax-system file shipped) has no known profile at all — the fact the OSS gate relies on', () => {
    expect(registry.has('GB')).toBe(false);
    expect(registry.resolve('GB')).toBeUndefined();
  });

  // OSS follow-up (2026-09-01): DE used to be the OSS gate's own textbook example of
  // "no destination rate table" — its own error message names DE verbatim. It no longer is: all 26
  // other EU member states' standard VAT rate were sourced from the European Commission's
  // TEDB (DG TAXUD) — see `data/de.json`'s own `provenance`. `data/all.spec.ts` pins every rate;
  // this test pins that the REGISTRY's own public `resolve()` — what `resolve-invoice-tax.ts`
  // actually calls — surfaces it correctly, composed through `toTaxSystemSpec`.
  it('DE now resolves with a real, TEDB-sourced standard rate (19%) — the OSS gate no longer blocks it', () => {
    const de = registry.resolve('DE');
    expect(de?.taxSystem.kind).toBe('VAT');
    if (de?.taxSystem.kind === 'VAT') {
      expect(de.taxSystem.standardRate).toBe(19);
      expect(de.taxSystem.reducedRates).toEqual([]); // not modeled — see de.json's own notes
    }
  });

  // HU (27%, the highest in the EU) and LU (17%, the lowest) were removed by the 5-country prune
  // (2026-09-10) — re-anchored on the two extremes among the KEPT countries instead (see
  // tax-systems/data/all.spec.ts's own matching test).
  it('PL/PT (23%, the highest among the kept countries) and DE (19%, the lowest) both resolve', () => {
    expect(registry.resolve('PL')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 23 });
    expect(registry.resolve('PT')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 23 });
    expect(registry.resolve('DE')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 19 });
  });
});

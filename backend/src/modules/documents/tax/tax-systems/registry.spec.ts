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

  it('US is a SALES_TAX system with the repère-ported state rates', () => {
    const us = registry.resolve('US');
    expect(us?.taxSystem.kind).toBe('SALES_TAX');
    if (us?.taxSystem.kind === 'SALES_TAX') {
      expect(us.taxSystem.stateRates.CA).toBe(7.25);
      expect(us.taxSystem.nexusSubdivisions).toContain('CA');
    }
  });

  it('IT/SA/AE/IN/QA are resolvable with their own explicit rates', () => {
    expect(registry.resolve('IT')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 22 });
    expect(registry.resolve('SA')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 15 });
    expect(registry.resolve('AE')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 5 });
    expect(registry.resolve('IN')?.taxSystem).toMatchObject({ kind: 'GST', standardRate: 18 });
    expect(registry.resolve('QA')?.taxSystem).toEqual({ kind: 'NONE' });
  });

  it('an uncatalogued country (the United Kingdom, GB — left the EU, no tax-system file shipped) has no known profile at all — the fact the OSS gate relies on', () => {
    expect(registry.has('GB')).toBe(false);
    expect(registry.resolve('GB')).toBeUndefined();
  });

  // Root TODO item 16 follow-up (2026-09-01): DE used to be the OSS gate's own textbook example of
  // "no destination rate table" — its own error message names DE verbatim. It no longer is: this
  // task sourced all 26 other EU member states' standard VAT rate from the European Commission's
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

  it('HU (27%, the highest in the EU) and LU (17%, the lowest) both resolve — the two extremes this task’s own report cites', () => {
    expect(registry.resolve('HU')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 27 });
    expect(registry.resolve('LU')?.taxSystem).toMatchObject({ kind: 'VAT', standardRate: 17 });
  });
});

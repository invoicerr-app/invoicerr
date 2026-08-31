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

  it('an uncatalogued country (Germany) has no known profile at all — the fact the OSS gate relies on', () => {
    expect(registry.has('DE')).toBe(false);
    expect(registry.resolve('DE')).toBeUndefined();
  });
});

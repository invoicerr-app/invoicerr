import { TransactionContext } from '../canonical/canonical-document';
import { DocumentTaxResult } from '../engine/tax-engine';
import { RecordingComplianceLogger } from '../execution/logger';
import { decimalsFor, money } from './tax-system';
import { defaultTaxSystemRegistry } from './registry';

const log = new RecordingComplianceLogger();

function ctx(quantity: number, unitNetMinor: number, currency = 'EUR'): TransactionContext {
  return { currency, lines: [{ id: 'l1', description: 'x', quantity, unitNetMinor, supplyType: 'GOODS' }] } as TransactionContext;
}
function taxAt(rate: number, category = 'S'): DocumentTaxResult {
  return {
    lines: [{ lineId: 'l1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: category as never, rate, jurisdiction: 'FR' }], buyerSelfAssess: false, reportingFlags: [], mentions: [] } }],
    reportingFlags: [], mentions: [], buyerSelfAssess: false,
  };
}

describe('money helpers', () => {
  it('decimalsFor knows 0/2/3-decimal currencies', () => {
    expect(decimalsFor('JPY')).toBe(0);
    expect(decimalsFor('EUR')).toBe(2);
    expect(decimalsFor('KWD')).toBe(3);
    expect(decimalsFor('zzz')).toBe(2);
  });
  it('money rounds to integer minor units and carries currency decimals', () => {
    expect(money(1234.6, 'EUR')).toEqual({ minor: 1235, currency: 'EUR', decimals: 2 });
    expect(money(100, 'JPY')).toEqual({ minor: 100, currency: 'JPY', decimals: 0 });
  });
});

describe('TaxSystemRegistry — money totals', () => {
  it('VAT: net + 20% tax over quantity', () => {
    const totals = defaultTaxSystemRegistry.get('VAT').computeTotals(ctx(2, 10000), taxAt(20), log);
    expect(totals.net.minor).toBe(20000);
    expect(totals.tax.minor).toBe(4000);
    expect(totals.gross.minor).toBe(24000);
  });

  it('GST shares the VAT arithmetic', () => {
    const totals = defaultTaxSystemRegistry.get('GST').computeTotals(ctx(1, 10000), taxAt(18), log);
    expect(totals.tax.minor).toBe(1800);
    expect(totals.gross.minor).toBe(11800);
  });

  it('a 0% component (reverse charge / export) yields zero tax', () => {
    const totals = defaultTaxSystemRegistry.get('VAT').computeTotals(ctx(1, 10000), taxAt(0, 'AE'), log);
    expect(totals.tax.minor).toBe(0);
    expect(totals.gross.minor).toBe(10000);
  });

  it('NONE: gross equals net', () => {
    const totals = defaultTaxSystemRegistry.get('NONE').computeTotals(ctx(3, 5000), { lines: [], reportingFlags: [], mentions: [], buyerSelfAssess: false }, log);
    expect(totals.net.minor).toBe(15000);
    expect(totals.tax.minor).toBe(0);
    expect(totals.gross.minor).toBe(15000);
  });

  it('SALES_TAX logs the local-stacking TODO but still totals', () => {
    const rec = new RecordingComplianceLogger();
    const totals = defaultTaxSystemRegistry.get('SALES_TAX').computeTotals(ctx(1, 10000), taxAt(7.25), rec);
    expect(totals.tax.minor).toBe(725);
    expect(rec.hasScope('taxsystem/sales-tax')).toBe(true);
  });

  it('defaults an unknown kind to NONE', () => {
    expect(defaultTaxSystemRegistry.get('XYZ' as never).kind).toBe('NONE');
  });
});

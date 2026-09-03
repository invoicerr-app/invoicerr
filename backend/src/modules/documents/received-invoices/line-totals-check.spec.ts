import { checkReceivedInvoiceLineTotals } from './line-totals-check';

/**
 * TODO_PRODUIT.md T5(a) — "le total contrôle la somme des lignes". Pure-function tests: no descriptor
 * registry, no persistence, just `data` in and warnings out — see this module's own header for why
 * the "sum of lines" side is `totals/compute-totals.ts`, unmodified, and why the tolerance is
 * `max(1, line count)` minor units.
 */
describe('received-invoices/line-totals-check', () => {
  it('no lines at all: never a warning, however wrong the stated totals are', () => {
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      netAmount: 1000,
      vatAmount: 999, // wildly wrong — irrelevant: there is nothing to control it against
      grossAmount: 1,
    });
    expect(warnings).toEqual([]);
  });

  it('an empty `lines` array is the same as no lines at all', () => {
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      lines: [],
      netAmount: 1000,
      vatAmount: 999,
      grossAmount: 1,
    });
    expect(warnings).toEqual([]);
  });

  it('lines that sum exactly to the stated totals: no warning', () => {
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
      netAmount: 1000,
      vatAmount: 200,
      grossAmount: 1200,
    });
    expect(warnings).toEqual([]);
  });

  it('a document with lines but NO stated totals at all: nothing to compare, no warning', () => {
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
    });
    expect(warnings).toEqual([]);
  });

  describe("rounding tolerance — max(1, line count) minor units, see this module's own header", () => {
    it('a 1-line document tolerates exactly a 1-cent difference', () => {
      const warnings = checkReceivedInvoiceLineTotals({
        currency: 'EUR',
        lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
        netAmount: 1000.01, // 1 cent over the exact 1000.00 the line sums to
      });
      expect(warnings).toEqual([]);
    });

    it('a 1-line document does NOT tolerate a 2-cent difference', () => {
      const warnings = checkReceivedInvoiceLineTotals({
        currency: 'EUR',
        lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
        netAmount: 1000.02,
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Line total mismatch \(net \/ HT\)/);
      expect(warnings[0]).toMatch(/1,000\.00 EUR|1000\.00 EUR/);
    });

    it('a 3-line document tolerates up to 3 cents (one per line), not 4', () => {
      const threeLines = [
        { description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'C', quantity: 1, unitPrice: 100, vatRate: '20' },
      ];
      // Lines sum to netMinor 30000 (300.00 EUR) exactly.
      expect(
        checkReceivedInvoiceLineTotals({ currency: 'EUR', lines: threeLines, netAmount: 300.03 }),
      ).toEqual([]);
      expect(
        checkReceivedInvoiceLineTotals({ currency: 'EUR', lines: threeLines, netAmount: 300.04 }),
      ).toHaveLength(1);
    });
  });

  it('names EACH mismatched total independently (net, VAT, gross can each carry their own warning)', () => {
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
      netAmount: 2000, // off by 1000 EUR
      vatAmount: 5, // off by 195 EUR
      grossAmount: 1, // off by 1199 EUR
    });
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes('net / HT'))).toBe(true);
    expect(warnings.some((w) => w.includes('VAT'))).toBe(true);
    expect(warnings.some((w) => w.includes('gross / TTC'))).toBe(true);
  });

  it('a line with no usable VAT rate is counted in net only — VAT/gross totals compare against that', () => {
    // No 'select' value at all: compute-totals.ts's own extractVatRate treats this as "no usable VAT
    // rate", so the whole line lands in netMinor with zero VAT — reused, not duplicated, here.
    const warnings = checkReceivedInvoiceLineTotals({
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100 }],
      netAmount: 1000,
      vatAmount: 0,
      grossAmount: 1000,
    });
    expect(warnings).toEqual([]);
  });

  it('falls back to EUR when no currency is resolvable, rather than throwing', () => {
    expect(() =>
      checkReceivedInvoiceLineTotals({
        lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
        netAmount: 1000,
      }),
    ).not.toThrow();
  });
});

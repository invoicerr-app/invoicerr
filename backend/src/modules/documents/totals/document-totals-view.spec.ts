import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { resolveDocumentTotalsView, resolveSettlementTotals } from './document-totals-view';

/**
 * Issue #487: GET .../totals and the settlement never add every option of a quote together. The
 * quote below has one common line and two options:
 *   Setup 50 + Basic 100   = 150 net, 180.00 gross
 *   Setup 50 + Premium 200 = 250 net, 300.00 gross
 *   every line summed      = 350 net, 420.00 gross (the figure nobody agreed to)
 */
const QUOTE = buildQuoteDescriptor();

const OPTION_DATA = {
  currency: 'EUR',
  lines: [
    { description: 'Setup', quantity: 1, unitPrice: 50, vatRate: '20' },
    { description: 'Basic plan', quantity: 1, unitPrice: 100, vatRate: '20', option: 'Basic' },
    { description: 'Premium plan', quantity: 1, unitPrice: 200, vatRate: '20', option: 'Premium' },
  ],
};

describe('resolveDocumentTotalsView (issue #487)', () => {
  it('gives no single total and one total per option while no option is accepted', () => {
    const view = resolveDocumentTotalsView('quote', QUOTE, OPTION_DATA, null);
    expect(view.grossMinor).toBeNull();
    expect(view.netMinor).toBeNull();
    expect(view.vatMinor).toBeNull();
    expect(view.vatBreakdown).toEqual([]);
    expect(view.acceptedOption).toBeNull();
    expect(view.currency).toBe('EUR');
    expect(view.options?.map(({ option, totals }) => [option, totals.netMinor, totals.grossMinor])).toEqual([
      ['Basic', 15000, 18000],
      ['Premium', 25000, 30000],
    ]);
  });

  it("carries the accepted option's totals, common line included, at the top level", () => {
    const view = resolveDocumentTotalsView('quote', QUOTE, OPTION_DATA, 'Premium');
    expect(view.acceptedOption).toBe('Premium');
    expect(view.netMinor).toBe(25000);
    expect(view.vatMinor).toBe(5000);
    expect(view.grossMinor).toBe(30000);
    expect(view.lines).toHaveLength(2);
    expect(view.options).toHaveLength(2);
  });

  it('gives no single total when the accepted option no longer exists (quote edited after acceptance)', () => {
    const view = resolveDocumentTotalsView('quote', QUOTE, OPTION_DATA, 'Gold');
    expect(view.grossMinor).toBeNull();
    expect(view.acceptedOption).toBeNull();
    expect(view.options).toHaveLength(2);
  });

  it('leaves a quote without options and an invoice exactly as before, whatever acceptedOption says', () => {
    const plain = { currency: 'EUR', lines: [OPTION_DATA.lines[0], OPTION_DATA.lines[1]] };
    const quoteView = resolveDocumentTotalsView('quote', QUOTE, plain, 'Basic');
    expect(quoteView.grossMinor).toBe(18000);
    expect(quoteView.options).toBeNull();
    expect(quoteView.acceptedOption).toBeNull();

    const invoiceView = resolveDocumentTotalsView('invoice', buildInvoiceDescriptor(), plain, null);
    expect(invoiceView.grossMinor).toBe(18000);
    expect(invoiceView.options).toBeNull();
  });
});

describe('resolveSettlementTotals (issue #487)', () => {
  it("settles an accepted quote against the accepted option's gross", () => {
    expect(resolveSettlementTotals('quote', QUOTE, OPTION_DATA, 'Basic', 'Q-1').grossMinor).toBe(18000);
  });

  it('refuses with 409 while no option is accepted, instead of summing every option', () => {
    expect(() => resolveSettlementTotals('quote', QUOTE, OPTION_DATA, null, 'Q-1')).toThrow(
      ConflictException,
    );
    expect(() => resolveSettlementTotals('quote', QUOTE, OPTION_DATA, 'Gold', 'Q-1')).toThrow(
      ConflictException,
    );
  });
});

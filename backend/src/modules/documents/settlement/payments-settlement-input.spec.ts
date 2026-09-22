/**
 * Added by the T3 VALIDATION pass (2026-09-03), after a replayed mutation went UNBITTEN: rewriting
 * `toSettlementPaymentInputs` to read the raw `amountMinor` instead of the pinned
 * `documentAmountMinor` left every settlement jest suite green — the mapping layer between
 * `DocumentPaymentResult` and `computeSettlement` (the exact line `documents.service.ts` and
 * `credit-note-actions.ts` both route through) had NO test driving a genuinely CONVERTED payment
 * through it. The e2e spec (24) covers it end-to-end through the API, but a silent regression here
 * deserves a unit-level tripwire too — this file is that tripwire, deliberately tiny.
 */
import { computeSettlement } from './compute-settlement';
import { DocumentPaymentResult, toSettlementPaymentInputs } from './payments';

function convertedPayment(overrides: Partial<DocumentPaymentResult> = {}): DocumentPaymentResult {
  return {
    id: 'pay-1',
    documentId: 'doc-1',
    // 100.00 USD received — but the DOCUMENT is in EUR: the settlement-relevant figure is the
    // pinned 92.00 EUR, never the raw 10000.
    amountMinor: 10000,
    currency: 'USD',
    documentAmountMinor: 9200,
    conversionRate: 0.92,
    conversionRateAsOf: new Date('2026-08-30T00:00:00Z'),
    conversionSource: 'manual',
    paidAt: new Date('2026-08-30T00:00:00Z'),
    method: null,
    note: null,
    createdAt: new Date('2026-08-30T00:00:00Z'),
    ...overrides,
  };
}

describe('toSettlementPaymentInputs — the pinned converted figure, never the raw one', () => {
  it('feeds computeSettlement the DOCUMENT-currency amount: a 100.00 USD payment pinned at 92.00 EUR leaves exactly 8.00 EUR remaining on a 100.00 EUR invoice', () => {
    const inputs = toSettlementPaymentInputs([convertedPayment()]);
    expect(inputs).toEqual([{ amountMinor: 9200 }]);

    const settlement = computeSettlement(10000, inputs, []);
    expect(settlement.outstandingMinor).toBe(800); // exact, not toBeCloseTo — rounding is a decision
    expect(settlement.settled).toBe(false);
  });

  it('a same-currency payment (documentAmountMinor === amountMinor, rate null) passes through unchanged', () => {
    const inputs = toSettlementPaymentInputs([
      convertedPayment({
        amountMinor: 10000,
        currency: 'EUR',
        documentAmountMinor: 10000,
        conversionRate: null,
        conversionRateAsOf: null,
        conversionSource: null,
      }),
    ]);
    expect(inputs).toEqual([{ amountMinor: 10000 }]);
    expect(computeSettlement(10000, inputs, []).settled).toBe(true);
  });
});

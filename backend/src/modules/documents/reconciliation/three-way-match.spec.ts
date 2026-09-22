import { computeThreeWayMatch, ThreeWayMatchInput } from './three-way-match';

/** The shared skeleton every case below overrides — one line, one receipt set, one invoice line,
 *  the default 2% tolerance a company gets out of the box (reconciliation-settings.ts). */
function baseInput(overrides: Partial<ThreeWayMatchInput> = {}): ThreeWayMatchInput {
  return {
    purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
    receiptLineSets: [[{ description: 'Widget', quantityReceived: 10 }]],
    invoiceLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
    tolerancePercent: 2,
    ...overrides,
  };
}

describe('computeThreeWayMatch', () => {
  it('exact match: ordered = received = invoiced, same price -> within-tolerance, zero variance', () => {
    const result = computeThreeWayMatch(baseInput());
    expect(result.overallVerdict).toBe('within-tolerance');
    expect(result.lines).toHaveLength(1);
    const [line] = result.lines;
    expect(line.quantityOrdered).toBe(10);
    expect(line.quantityReceived).toBe(10);
    expect(line.quantityInvoiced).toBe(10);
    expect(line.quantityVarianceValue).toBe(0);
    expect(line.quantityVariancePercent).toBe(0);
    expect(line.priceVarianceValue).toBe(0);
    expect(line.totalVarianceValue).toBe(0);
    expect(line.verdict).toBe('within-tolerance');
  });

  it('sous-livraison: only 6 of 10 received, but the invoice still bills for the full 10 -> to-review', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 6 }]],
        invoiceLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
      }),
    );
    const [line] = result.lines;
    expect(line.quantityOrdered).toBe(10);
    expect(line.quantityReceived).toBe(6);
    expect(line.quantityInvoiced).toBe(10);
    // (10 - 6) / 6 * 100 ≈ 66.67% — far beyond the 2% default tolerance.
    expect(line.quantityVariancePercent).toBeCloseTo(66.6667, 3);
    expect(line.verdict).toBe('to-review');
    expect(result.overallVerdict).toBe('to-review');
  });

  it('sous-livraison honestly billed for what shipped (6 received, invoice for 6) -> within-tolerance', () => {
    // The mirror case: an under-delivery is NOT itself a variance once the supplier only bills for
    // what actually shipped — see three-way-match.ts's own header ("received invoice is the quantity
    // truth"). Ordered (10) staying above received/invoiced (6) is informational, not a flag.
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 6 }]],
        invoiceLines: [{ description: 'Widget', quantity: 6, unitPrice: 100 }],
      }),
    );
    expect(result.overallVerdict).toBe('within-tolerance');
    expect(result.lines[0].quantityOrdered).toBe(10);
  });

  it('sur-facturation: 5 received, invoice bills for 8 -> to-review', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 5, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 5 }]],
        invoiceLines: [{ description: 'Widget', quantity: 8, unitPrice: 100 }],
      }),
    );
    const [line] = result.lines;
    // (8 - 5) / 5 * 100 = 60%.
    expect(line.quantityVariancePercent).toBeCloseTo(60, 5);
    expect(line.verdict).toBe('to-review');
  });

  it('prix différent: quantities agree everywhere, invoice unit price is 20% above the PO -> to-review', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 10 }]],
        invoiceLines: [{ description: 'Widget', quantity: 10, unitPrice: 120 }],
      }),
    );
    const [line] = result.lines;
    expect(line.priceVariancePercent).toBeCloseTo(20, 5);
    expect(line.priceVarianceValue).toBe(20);
    expect(line.verdict).toBe('to-review');
    // The total variance moves in lockstep with the price variance here (same quantity everywhere).
    expect(line.totalVariancePercent).toBeCloseTo(20, 5);
  });

  it('plusieurs réceptions partielles: two receipts summing to 15, invoice for 15 -> within-tolerance', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 20, unitPrice: 10 }],
        receiptLineSets: [
          [{ description: 'Widget', quantityReceived: 8 }],
          [{ description: 'Widget', quantityReceived: 7 }],
        ],
        invoiceLines: [{ description: 'Widget', quantity: 15, unitPrice: 10 }],
      }),
    );
    const [line] = result.lines;
    expect(line.quantityReceived).toBe(15); // summed across BOTH receipts, never just the last one.
    expect(line.quantityOrdered).toBe(20);
    expect(line.verdict).toBe('within-tolerance');
    expect(result.overallVerdict).toBe('within-tolerance');
  });

  it('tolérance 0: an exact match still passes, but the smallest real gap is flagged', () => {
    const exact = computeThreeWayMatch(baseInput({ tolerancePercent: 0 }));
    expect(exact.overallVerdict).toBe('within-tolerance');

    const tinyGap = computeThreeWayMatch(
      baseInput({
        tolerancePercent: 0,
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 10 }]],
        invoiceLines: [{ description: 'Widget', quantity: 10, unitPrice: 100.01 }],
      }),
    );
    expect(tinyGap.overallVerdict).toBe('to-review');
    // The SAME 0.01 gap stays within a normal 2% tolerance.
    const sameGapNormalTolerance = computeThreeWayMatch(
      baseInput({
        tolerancePercent: 2,
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 10 }]],
        invoiceLines: [{ description: 'Widget', quantity: 10, unitPrice: 100.01 }],
      }),
    );
    expect(sameGapNormalTolerance.overallVerdict).toBe('within-tolerance');
  });

  it('a PO line never received nor invoiced yet stays within-tolerance — nothing to review', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[]],
        invoiceLines: [],
      }),
    );
    expect(result.overallVerdict).toBe('within-tolerance');
    expect(result.lines[0].quantityReceived).toBe(0);
    expect(result.lines[0].quantityInvoiced).toBe(0);
  });

  it('an invoice line with no matching PO/receipt at all -> to-review (unmeasurable, never waved through)', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'Widget', quantityReceived: 10 }]],
        invoiceLines: [
          { description: 'Widget', quantity: 10, unitPrice: 100 },
          { description: 'Surprise fee', quantity: 1, unitPrice: 50 },
        ],
      }),
    );
    const surprise = result.lines.find((line) => line.description === 'Surprise fee');
    expect(surprise).toBeDefined();
    expect(surprise?.unitPriceOrdered).toBeNull();
    expect(surprise?.verdict).toBe('to-review');
    expect(result.overallVerdict).toBe('to-review');
  });

  it('matches descriptions case-insensitively and trims whitespace', () => {
    const result = computeThreeWayMatch(
      baseInput({
        purchaseOrderLines: [{ description: '  Widget  ', quantity: 10, unitPrice: 100 }],
        receiptLineSets: [[{ description: 'WIDGET', quantityReceived: 10 }]],
        invoiceLines: [{ description: 'widget', quantity: 10, unitPrice: 100 }],
      }),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.overallVerdict).toBe('within-tolerance');
  });
});

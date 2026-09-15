/**
 * TODO_FEATURES.md rank 19, second pass — the 3-WAY MATCH ENGINE: purchase order (BC) × goods
 * receipt(s) × received invoice, PER LINE, matched by DESCRIPTION. A pure function, deliberately
 * knowing nothing about `DocumentInstance`, Prisma, or a company — the same "engine composes plain
 * data, never touches persistence itself" discipline `tax/tax-engine.ts` already holds for cross-
 * border tax determination (see that file's own header). The composition that turns three real
 * documents into this function's own input shape lives in
 * `resolve-received-invoice-reconciliation.ts`; this file is tested standalone, with hand-built
 * fixtures, exactly like `tax-engine.spec.ts` already tests its own engine.
 *
 * ## Matching key — DESCRIPTION, normalized (trim + lowercase), never a stable row id
 *
 * A purchase order's own lines, a goods receipt's own lines, and a received invoice's own lines are
 * three INDEPENDENT arrays, written by three different actors at three different times (this
 * company's own buyer typing the PO; this company's own warehouse typing what arrived; whatever the
 * SUPPLIER's invoice says, typed or extracted) — there is no shared, machine-assigned identity across
 * them the way `row-selection/row-selection.ts`'s own `$rowId` links a CREDIT NOTE back to the ONE
 * invoice it corrects. Matching by description is a pragmatic, honestly-limited choice, not a
 * researched one: the SAME "exact-or-nothing" posture `received-invoices/supplier-reconciliation.ts`
 * documents for its own name-matching fallback, chosen for the identical reason (no safer signal is
 * available). Normalized case-insensitively (unlike that module's own name match, which stays
 * case-SENSITIVE on purpose) because a line description is free text RETYPED by up to three different
 * people across three different documents — "10x A4 paper" vs. "10x A4 Paper" is obviously the same
 * line, in a way "Dupont" vs. "DUPONT" as two DIFFERENT company names is not (see that module's own
 * header for why THAT distinction goes the other way). KNOWN, DOCUMENTED LIMITATION: two genuinely
 * different lines that happen to share an identical description are matched as ONE aggregate line —
 * an honest simplification, not a silent bug, the same class of trade-off `supplier-reconciliation.ts`
 * already accepts for its own matching.
 *
 * ## Verdict logic — GOODS RECEIPT is the quantity truth, the PURCHASE ORDER is the price truth
 *
 * Standard 3-way-match AP practice, applied literally: a line is only EVER checked once it has
 * actually been INVOICED (`quantityInvoiced > 0`) — a PO line not yet received, or received but not
 * yet billed, has nothing to review yet and stays `within-tolerance` unconditionally. Once invoiced:
 *  - QUANTITY variance compares what was INVOICED against what was actually RECEIVED (never against
 *    what was merely ORDERED) — the whole point of a goods receipt is to pay for what arrived, not
 *    for what was asked for; a genuine under-delivery that the supplier honestly bills only for what
 *    shipped is NOT a variance at all under this rule.
 *  - PRICE variance compares the invoice's own unit price against the PURCHASE ORDER's — the price
 *    this company actually agreed to pay, regardless of what arrived or when.
 *  - TOTAL variance compares the invoiced line total against the EXPECTED one (received quantity ×
 *    the PO's own unit price) — the single number that answers "are we being asked to pay a
 *    materially different amount than what we agreed to, for what we actually got".
 * Each of the three is expressed both as an absolute VALUE and a PERCENT relative to its own
 * "expected" baseline (`safePercent`, below); the line's own verdict is `to-review` the moment ANY of
 * the three percentages is unmeasurable (expected is zero but the actual isn't — nothing to compare
 * against, so it cannot be waved through) or exceeds `tolerancePercent` in absolute value. Strictly
 * GREATER THAN, never `>=`: a `tolerancePercent` of 0 (a company that wants ZERO leeway) still lets an
 * EXACT match through, which is what the "tolérance 0" test below exists to prove.
 *
 * `verdict` here is only ever `'within-tolerance' | 'to-review'` — never `'accepted'`, the third state
 * the product spec names: an acceptance is a HUMAN decision recorded elsewhere
 * (`variance-acceptance.ts`), layered on top of this engine's own output by
 * `resolve-received-invoice-reconciliation.ts`, never something this pure function can decide for
 * itself.
 */

export interface PurchaseOrderLineInput {
  description: string;
  /** The quantity ordered — BC's own `quantity` field. */
  quantity: number;
  /** The BC's own agreed unit price — the PRICE truth this engine checks an invoice against. */
  unitPrice: number;
}

export interface GoodsReceiptLineInput {
  description: string;
  /** How much of this line was actually received — a goods-receipt's own `quantityReceived` field. */
  quantityReceived: number;
}

export interface ReceivedInvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface ThreeWayMatchInput {
  purchaseOrderLines: PurchaseOrderLineInput[];
  /**
   * ONE ARRAY PER GOODS-RECEIPT document that references this PO — never pre-flattened by the
   * caller: several partial receipts against the SAME purchase order is the routine case (see this
   * file's own "plusieurs réceptions partielles" test), and keeping them separate here is what lets
   * this function do the SUMMING itself, in one place, rather than trusting every caller to have
   * aggregated correctly beforehand.
   */
  receiptLineSets: GoodsReceiptLineInput[][];
  invoiceLines: ReceivedInvoiceLineInput[];
  /** A NON-NEGATIVE percentage — the company's own configured leeway (default 2, see
   *  `reconciliation-settings.ts`). 0 is a valid, meaningful value (see this file's own header). */
  tolerancePercent: number;
}

export type LineMatchVerdict = 'within-tolerance' | 'to-review';

export interface ThreeWayMatchLine {
  /** The normalized key every source's own raw description matched on — see this file's own header.
   *  Not necessarily identical, character-for-character, to any ONE source's own text. */
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityInvoiced: number;
  /** Null when this description never appeared on the PO at all (an invoice line with nothing to
   *  compare its price against) — never fabricated as 0, which would silently read as "free". */
  unitPriceOrdered: number | null;
  /** Null when this description never appeared on the invoice — nothing was actually billed for it
   *  (yet), so there is no invoiced price to show. */
  unitPriceInvoiced: number | null;
  quantityVarianceValue: number;
  /** Null when unmeasurable (see `safePercent` below) — ALWAYS drives the line to `to-review` when
   *  null, together with the other two percents. */
  quantityVariancePercent: number | null;
  priceVarianceValue: number;
  priceVariancePercent: number | null;
  /** received quantity × the PO's own unit price — "what we should pay for what we actually got, at
   *  the price we agreed to" — 0 when no PO price is known at all. */
  expectedTotal: number;
  /** invoiced quantity × the invoice's own unit price. */
  invoicedTotal: number;
  totalVarianceValue: number;
  totalVariancePercent: number | null;
  verdict: LineMatchVerdict;
}

export interface ThreeWayMatchResult {
  tolerancePercent: number;
  lines: ThreeWayMatchLine[];
  /** `to-review` the moment ANY line is — a single overlooked line is exactly the risk this whole
   *  feature exists to surface, so the aggregate can never be more lenient than its worst line. */
  overallVerdict: LineMatchVerdict;
}

function normalizeDescription(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * `(actual - expected) / expected × 100`, with the two genuinely different "nothing to measure"
 * cases this ratio cannot express on its own kept honestly distinct:
 *  - `expected === 0 && actual === 0`: nothing happened on either side — 0%, a real, measured
 *    agreement, not a gap.
 *  - `expected === 0 && actual !== 0`: something was billed/priced against a baseline of ZERO (an
 *    invoice line with no matching PO line or receipt at all) — no ratio can express that honestly,
 *    so this returns `null` rather than a fabricated ±Infinity; every caller in this file treats
 *    `null` as "exceeds tolerance", never as "fine".
 */
function safePercent(actual: number, expected: number): number | null {
  if (expected === 0) return actual === 0 ? 0 : null;
  return ((actual - expected) / expected) * 100;
}

function exceedsTolerance(percent: number | null, tolerancePercent: number): boolean {
  return percent === null || Math.abs(percent) > tolerancePercent;
}

export function computeThreeWayMatch(input: ThreeWayMatchInput): ThreeWayMatchResult {
  const { purchaseOrderLines, receiptLineSets, invoiceLines, tolerancePercent } = input;

  const orderedByDescription = new Map<
    string,
    { description: string; quantity: number; unitPrice: number }
  >();
  for (const line of purchaseOrderLines) {
    const key = normalizeDescription(line.description);
    const existing = orderedByDescription.get(key);
    orderedByDescription.set(key, {
      description: existing?.description ?? line.description,
      quantity: (existing?.quantity ?? 0) + line.quantity,
      // A repeated description on the SAME PO keeps the FIRST line's own unit price — two rows that
      // share a description but disagree on price is a data problem this engine does not try to
      // resolve on its own, the same "first match wins, never silently averaged" posture as leaving
      // this undefined would otherwise require a caller to guess.
      unitPrice: existing?.unitPrice ?? line.unitPrice,
    });
  }

  const receivedByDescription = new Map<string, number>();
  for (const receiptLines of receiptLineSets) {
    for (const line of receiptLines) {
      const key = normalizeDescription(line.description);
      receivedByDescription.set(key, (receivedByDescription.get(key) ?? 0) + line.quantityReceived);
    }
  }

  const invoicedByDescription = new Map<
    string,
    { description: string; quantity: number; unitPrice: number }
  >();
  for (const line of invoiceLines) {
    const key = normalizeDescription(line.description);
    const existing = invoicedByDescription.get(key);
    invoicedByDescription.set(key, {
      description: existing?.description ?? line.description,
      quantity: (existing?.quantity ?? 0) + line.quantity,
      unitPrice: existing?.unitPrice ?? line.unitPrice,
    });
  }

  // Every description ANY of the three sources named — a PO line never received/invoiced yet still
  // shows up (verdict `within-tolerance`, see this file's own header), and so does an invoice line
  // with no PO/receipt counterpart at all (verdict `to-review`, via `safePercent`'s own null case).
  const allKeys = new Set<string>([
    ...orderedByDescription.keys(),
    ...receivedByDescription.keys(),
    ...invoicedByDescription.keys(),
  ]);

  const lines: ThreeWayMatchLine[] = [...allKeys].map((key) => {
    const ordered = orderedByDescription.get(key);
    const invoiced = invoicedByDescription.get(key);
    const quantityReceived = receivedByDescription.get(key) ?? 0;
    const quantityOrdered = ordered?.quantity ?? 0;
    const quantityInvoiced = invoiced?.quantity ?? 0;
    const unitPriceOrdered = ordered?.unitPrice ?? null;
    const unitPriceInvoiced = invoiced?.unitPrice ?? null;

    const expectedTotal = quantityReceived * (unitPriceOrdered ?? 0);
    const invoicedTotal = quantityInvoiced * (unitPriceInvoiced ?? 0);

    // Nothing has been INVOICED for this line yet — nothing to review, whatever the ordered/received
    // gap looks like (see this file's own header). A line in this branch is always `within-tolerance`.
    if (quantityInvoiced === 0) {
      return {
        description: ordered?.description ?? invoiced?.description ?? key,
        quantityOrdered,
        quantityReceived,
        quantityInvoiced,
        unitPriceOrdered,
        unitPriceInvoiced,
        quantityVarianceValue: 0,
        quantityVariancePercent: 0,
        priceVarianceValue: 0,
        priceVariancePercent: 0,
        expectedTotal,
        invoicedTotal,
        totalVarianceValue: 0,
        totalVariancePercent: 0,
        verdict: 'within-tolerance',
      };
    }

    const quantityVariancePercent = safePercent(quantityInvoiced, quantityReceived);
    const priceVariancePercent = safePercent(unitPriceInvoiced ?? 0, unitPriceOrdered ?? 0);
    const totalVariancePercent = safePercent(invoicedTotal, expectedTotal);

    const verdict: LineMatchVerdict =
      exceedsTolerance(quantityVariancePercent, tolerancePercent) ||
      exceedsTolerance(priceVariancePercent, tolerancePercent) ||
      exceedsTolerance(totalVariancePercent, tolerancePercent)
        ? 'to-review'
        : 'within-tolerance';

    return {
      description: ordered?.description ?? invoiced?.description ?? key,
      quantityOrdered,
      quantityReceived,
      quantityInvoiced,
      unitPriceOrdered,
      unitPriceInvoiced,
      quantityVarianceValue: quantityInvoiced - quantityReceived,
      quantityVariancePercent,
      priceVarianceValue: (unitPriceInvoiced ?? 0) - (unitPriceOrdered ?? 0),
      priceVariancePercent,
      expectedTotal,
      invoicedTotal,
      totalVarianceValue: invoicedTotal - expectedTotal,
      totalVariancePercent,
      verdict,
    };
  });

  const overallVerdict: LineMatchVerdict = lines.some((line) => line.verdict === 'to-review')
    ? 'to-review'
    : 'within-tolerance';

  return { tolerancePercent, lines, overallVerdict };
}

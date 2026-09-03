import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import { creditsForInvoiceFromNotes, resolveCreditsForDocument, toSettlementCreditInputs } from './credits';

/**
 * `creditsForInvoiceFromNotes` — the pure resolution step behind item 8 of the root TODO ("le
 * lettrage"). Pure and DB-free (see this module's own header on why the status/currency rules live
 * here rather than in the Prisma query), so every rule is proven with plain fixtures, no mocking.
 */

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

// Two lines: 100 EUR net (20% VAT -> 120 gross, 12000 minor) and 50 EUR net (20% VAT -> 60 gross,
// 6000 minor) — a full invoice therefore owes 18000 minor gross.
const invoiceData = {
  client: 'client-1',
  issueDate: '2026-01-15',
  dueDate: '2026-02-15',
  currency: 'EUR',
  lines: [
    { [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '20' },
    { [ROW_ID_KEY]: 'line-2', description: 'Gadget', quantity: 1, unitPrice: 50, vatRate: '20' },
  ],
};

function creditNote(overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> }) {
  return {
    id: 'cn-1',
    typeId: 'credit-note',
    status: 'sent',
    displayNumber: null,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    ...overrides,
  } as DocumentInstanceResult;
}

describe('creditsForInvoiceFromNotes', () => {
  it('counts a SENT credit note referencing this invoice, crediting the GROSS/TTC of the ONE selected line', () => {
    const notes = [creditNote({ data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1'] } })];

    const { credits, warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(warnings).toEqual([]);
    expect(credits).toEqual([{ id: 'cn-1', displayNumber: null, amountMinor: 12000, currency: 'EUR' }]);
  });

  it("a credit note selecting EVERY line credits the invoice's own full gross total", () => {
    const notes = [
      creditNote({ data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1', 'line-2'] } }),
    ];

    const { credits } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits[0].amountMinor).toBe(18000);
  });

  it('the credited amount excludes lines that were NOT selected — only line-2, not the full total', () => {
    const notes = [creditNote({ data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-2'] } })];

    const { credits } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits[0].amountMinor).toBe(6000);
  });

  it('several sent, matching credit notes ACCUMULATE — each kept as its own entry, never merged into one', () => {
    const notes = [
      creditNote({ id: 'cn-1', data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1'] } }),
      creditNote({ id: 'cn-2', data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-2'] } }),
    ];

    const { credits } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits).toHaveLength(2);
    expect(credits.map((c) => c.amountMinor).sort((a, b) => a - b)).toEqual([6000, 12000]);
  });

  it('a DRAFT credit note settles nothing — excluded silently, no warning (an unfinished document is normal)', () => {
    const notes = [
      creditNote({
        status: 'draft',
        data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1'] },
      }),
    ];

    const { credits, warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("a credit note referencing a DIFFERENT invoice is simply not this one's — skipped, no warning", () => {
    const notes = [
      creditNote({ data: { invoice: 'some-other-invoice', currency: 'EUR', correctedLines: ['line-1'] } }),
    ];

    const { credits, warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits).toEqual([]);
    expect(warnings).toEqual([]);
  });

  // TODO_PRODUIT.md T3 ("un avoir suit la même règle que sa facture") — a credit note whose OWN
  // `currency` field differs from the invoice's used to be EXCLUDED here entirely. It no longer is:
  // `computeCreditedAmountMinor` computes the credited amount FROM the invoice's own priced lines
  // (never the note's), so the number is ALREADY, unavoidably, the invoice's own currency — applying
  // an exchange rate to it would corrupt an already-correct figure, not "convert" it. See this file's
  // own header on `CreditsForDocument.warnings` for the full reasoning.
  it("a credit note whose OWN currency differs from the invoice's is still COUNTED — the amount is always the invoice's own currency, informationally NAMED, never excluded", () => {
    const notes = [
      creditNote({
        id: 'cn-usd',
        displayNumber: 'CN-2026-0001',
        data: { invoice: 'inv-1', currency: 'USD', correctedLines: ['line-1'] },
      }),
    ];

    const { credits, warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    // COUNTED, at the exact same amount a matching-currency note would credit — and labeled with the
    // INVOICE's own currency (EUR), never the note's own mislabeled USD (the number was never USD).
    expect(credits).toEqual([
      { id: 'cn-usd', displayNumber: 'CN-2026-0001', amountMinor: 12000, currency: 'EUR' },
    ]);
    expect(warnings).toHaveLength(1);
    // The warning still NAMES the credit note (by displayNumber when it has one) and both currencies
    // — never silent about the mismatch, even though it no longer blocks anything.
    expect(warnings[0]).toContain('CN-2026-0001');
    expect(warnings[0]).toContain('USD');
    expect(warnings[0]).toContain('EUR');
  });

  it('falls back to the raw id in the warning when the credit note has no displayNumber yet', () => {
    const notes = [
      creditNote({
        id: 'cn-raw-id',
        data: { invoice: 'inv-1', currency: 'USD', correctedLines: ['line-1'] },
      }),
    ];

    const { warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(warnings[0]).toContain('cn-raw-id');
  });

  it('a mix of matching, foreign-currency-labeled, draft, and unrelated credit notes resolves each independently — the foreign-labeled one still counts', () => {
    const notes = [
      creditNote({ id: 'good', data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1'] } }),
      creditNote({ id: 'foreign', data: { invoice: 'inv-1', currency: 'USD', correctedLines: ['line-2'] } }),
      creditNote({
        id: 'draft-one',
        status: 'draft',
        data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-1'] },
      }),
      creditNote({
        id: 'elsewhere',
        data: { invoice: 'inv-2', currency: 'EUR', correctedLines: ['line-1'] },
      }),
    ];

    const { credits, warnings } = creditsForInvoiceFromNotes(notes, 'inv-1', INVOICE_DESCRIPTOR, invoiceData);

    expect(credits).toEqual([
      { id: 'good', displayNumber: null, amountMinor: 12000, currency: 'EUR' },
      // 'foreign' selects line-2 (6000 minor) — counted, labeled EUR (the invoice's own), not USD.
      { id: 'foreign', displayNumber: null, amountMinor: 6000, currency: 'EUR' },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('foreign');
  });
});

describe('toSettlementCreditInputs', () => {
  it('narrows to exactly what computeSettlement needs — id and amountMinor', () => {
    const inputs = toSettlementCreditInputs([
      { id: 'cn-1', displayNumber: 'CN-1', amountMinor: 1200, currency: 'EUR' },
    ]);
    expect(inputs).toEqual([{ id: 'cn-1', amountMinor: 1200 }]);
  });
});

describe('resolveCreditsForDocument', () => {
  it('returns no credits, with no database access at all, for any type other than "invoice"', async () => {
    // No Prisma mock is set up in this file at all — if this reached the database it would throw
    // (or hang) rather than resolve, so a passing test here IS the proof this short-circuits first.
    const result = await resolveCreditsForDocument('company-1', 'quote', 'quote-1', INVOICE_DESCRIPTOR, {});
    expect(result).toEqual({ credits: [], warnings: [] });
  });
});

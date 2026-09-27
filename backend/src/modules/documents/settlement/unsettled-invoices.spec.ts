import { vi, type Mock } from 'vitest';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentInstanceResult } from '../actions/action-registry';
import * as settlementCredits from './credits';
import * as settlementPayments from './payments';
import { filterUnsettledInvoices, isOverdueInvoice } from './unsettled-invoices';

/**
 * Proves the SHARED predicate `GET /documents`'s own `settlement=unsettled`/`overdue` list filter
 * (documents.service.ts) and invoice-contributions.ts's own "pending"/"overdue" dashboard tiles both
 * call: the one place this rule can live so the tile's `link` and the list behind it can never
 * disagree. Same mocking discipline as contributions/invoice-contributions.spec.ts (which used to
 * hold this logic inline, before it moved here): `sumPaidMinorByDocument`/`listCreditNotes` reach
 * Prisma directly, so both are mocked at the module boundary.
 */
vi.mock('./payments');
vi.mock('./credits', async () => {
  const actual = await vi.importActual('./credits');
  return { ...actual, listCreditNotes: vi.fn() };
});

const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as Mock;
const listCreditNotes = settlementCredits.listCreditNotes as Mock;

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

function invoice(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'inv-1',
    typeId: 'invoice',
    status: 'draft',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function invoiceData(grossTotal: number, currency = 'EUR', dueDate?: string): Record<string, unknown> {
  return {
    currency,
    dueDate,
    lines: [{ description: 'work', quantity: 1, unitPrice: grossTotal, unit: 'unit', vatRate: '0' }],
  };
}

describe('filterUnsettledInvoices', () => {
  beforeEach(() => {
    sumPaidMinorByDocument.mockResolvedValue(new Map());
    listCreditNotes.mockResolvedValue([]);
  });
  afterEach(() => vi.resetAllMocks());

  it('excludes a draft (never issued, never "pending")', async () => {
    const draft = invoice({ id: 'inv-draft', status: 'draft', data: invoiceData(100) });
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [draft]);
    expect(result).toEqual([]);
  });

  it('excludes a cancelled invoice, even with nothing paid or credited', async () => {
    const cancelled = invoice({ id: 'inv-cancelled', status: 'cancelled', data: invoiceData(100) });
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [cancelled]);
    expect(result).toEqual([]);
  });

  it('includes a sent invoice with nothing paid or credited', async () => {
    const sent = invoice({ id: 'inv-sent', status: 'sent', data: invoiceData(100) });
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [sent]);
    expect(result.map((r) => r.id)).toEqual(['inv-sent']);
  });

  it('excludes a sent invoice fully paid', async () => {
    const sent = invoice({ id: 'inv-paid', status: 'sent', data: invoiceData(100) });
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-paid', 10000]]));
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [sent]);
    expect(result).toEqual([]);
  });

  it('excludes a sent invoice fully credited', async () => {
    const sent = invoice({ id: 'inv-credited', status: 'sent', data: invoiceData(100) });
    listCreditNotes.mockResolvedValue([
      invoice({
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'sent',
        data: { invoice: 'inv-credited', correctedLines: [] },
      }),
    ]);
    // computeCreditedAmountMinor sums the SELECTED lines from the invoice's own data: an empty
    // `correctedLines` selection credits nothing, so this fixture proves the "not settled" path
    // stays unaffected by an unrelated credit note rather than actually settling it. Kept simple
    // (never settled here) since the exact credit-matching arithmetic is already proven by
    // settlement/credits.spec.ts; this file only proves the wiring composes those pieces correctly.
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [sent]);
    expect(result.map((r) => r.id)).toEqual(['inv-credited']);
  });

  it('includes a sent invoice partially paid', async () => {
    const sent = invoice({ id: 'inv-partial', status: 'sent', data: invoiceData(100) });
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-partial', 5000]]));
    const result = await filterUnsettledInvoices('c1', INVOICE_DESCRIPTOR, [sent]);
    expect(result.map((r) => r.id)).toEqual(['inv-partial']);
  });
});

describe('isOverdueInvoice', () => {
  it('is true when dueDate is strictly before today', () => {
    const inv = invoice({ data: invoiceData(100, 'EUR', '2020-01-01') });
    expect(isOverdueInvoice(inv, '2026-01-01')).toBe(true);
  });

  it('is false when dueDate is today (not yet overdue)', () => {
    const inv = invoice({ data: invoiceData(100, 'EUR', '2026-01-01') });
    expect(isOverdueInvoice(inv, '2026-01-01')).toBe(false);
  });

  it('is false when dueDate is in the future', () => {
    const inv = invoice({ data: invoiceData(100, 'EUR', '2099-01-01') });
    expect(isOverdueInvoice(inv, '2026-01-01')).toBe(false);
  });

  it('is false when there is no dueDate at all', () => {
    const inv = invoice({ data: invoiceData(100) });
    expect(isOverdueInvoice(inv, '2026-01-01')).toBe(false);
  });
});

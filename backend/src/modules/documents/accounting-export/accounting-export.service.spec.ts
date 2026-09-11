import { BadRequestException } from '@nestjs/common';

import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import * as persistence from '../persistence';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { DocumentPaymentResult } from '../settlement/payments';
import { buildAccountingExport } from './accounting-export.service';
import * as clientLabels from './client-labels';

/**
 * Same mocking discipline as `settlement/client-statement.spec.ts` (this file's own model): `../
 * persistence` and `../settlement/payments` fully mocked (both reach Prisma directly), `../settlement/
 * credits` mocked ONLY for `listCreditNotes` (the one function here that reaches Prisma) —
 * `creditsForInvoiceFromNotes`/`toSettlementCreditInputs` stay the REAL, already-proven implementation
 * (credits.spec.ts), so this file never re-litigates rules that module already owns. `./client-labels`
 * is mocked wholesale — it is this feature's OWN new Prisma boundary (`prisma.client.findMany`).
 */
jest.mock('../persistence');
jest.mock('../settlement/payments');
jest.mock('../settlement/credits', () => {
  const actual = jest.requireActual('../settlement/credits');
  return { ...actual, listCreditNotes: jest.fn() };
});
jest.mock('./client-labels');

const listDocuments = persistence.listDocuments as jest.Mock;
const findOwnedDocumentsByIds = persistence.findOwnedDocumentsByIds as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listPaymentsInRange = settlementPayments.listPaymentsInRange as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;
const resolveClientLabels = clientLabels.resolveClientLabels as jest.Mock;

// Two lines: 100 EUR net (20% VAT -> 120 gross, 12000 minor) and 50 EUR net (20% VAT -> 60 gross,
// 6000 minor) — full gross 18000 minor, the same fixture `client-statement.spec.ts`/`credits.spec.ts`
// already use.
function invoiceData(overrides: Record<string, unknown> = {}) {
  return {
    client: 'client-1',
    issueDate: '2026-03-15',
    dueDate: '2026-04-15',
    currency: 'EUR',
    lines: [
      { [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '20' },
      { [ROW_ID_KEY]: 'line-2', description: 'Gadget', quantity: 1, unitPrice: 50, vatRate: '20' },
    ],
    ...overrides,
  };
}

function invoice(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'inv-1',
    typeId: 'invoice',
    status: 'sent',
    displayNumber: 'INV-2026-0001',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function creditNote(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'cn-1',
    typeId: 'credit-note',
    status: 'sent',
    displayNumber: 'CN-2026-0001',
    createdAt: new Date('2026-03-20'),
    updatedAt: new Date('2026-03-20'),
    ...overrides,
  };
}

function payment(overrides: Partial<DocumentPaymentResult> = {}): DocumentPaymentResult {
  return {
    id: 'pay-1',
    documentId: 'inv-1',
    amountMinor: 12000,
    currency: 'EUR',
    documentAmountMinor: 12000,
    conversionRate: null,
    conversionRateAsOf: null,
    conversionSource: null,
    method: 'bank_transfer',
    paidAt: new Date('2026-03-25T10:00:00.000Z'),
    note: null,
    createdAt: new Date('2026-03-25T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  listDocuments.mockReset().mockResolvedValue([]);
  findOwnedDocumentsByIds.mockReset().mockResolvedValue([]);
  sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
  listPaymentsInRange.mockReset().mockResolvedValue([]);
  listCreditNotes.mockReset().mockResolvedValue([]);
  resolveClientLabels.mockReset().mockResolvedValue(new Map());
});

const HEADER = 'type,reference,date,client,currency,net,vat,gross,paid,method,status';

describe('buildAccountingExport — validation', () => {
  it('rejects a missing "from"', async () => {
    await expect(buildAccountingExport('company-1', '', '2026-03-31')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a malformed "to"', async () => {
    await expect(buildAccountingExport('company-1', '2026-03-01', '31/03/2026')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects "from" after "to"', async () => {
    await expect(buildAccountingExport('company-1', '2026-04-01', '2026-03-01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('buildAccountingExport — an empty period', () => {
  it('produces a header-only CSV when nothing falls in range', async () => {
    const csv = await buildAccountingExport('company-1', '2026-01-01', '2026-01-31');
    expect(csv).toBe(HEADER);
  });
});

describe('buildAccountingExport — invoices', () => {
  it("an invoice's own issueDate inside the period appears, with amounts from computeDocumentTotals", async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-03-15' }) })]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    const line = csv.split('\n')[1];

    // 100+50 = 150.00 net, 20% VAT = 30.00, gross 180.00 — computeDocumentTotals's own arithmetic,
    // never re-derived by this file.
    expect(line).toBe('invoice,INV-2026-0001,2026-03-15,client-1,EUR,150.00,30.00,180.00,,,outstanding');
  });

  it("an invoice whose own issueDate is OUTSIDE the period is excluded, even though it's the only invoice", async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-02-15' }) })]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv).toBe(HEADER);
  });

  it('a DRAFT invoice never appears — never issued, nothing real to export yet', async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'draft-1', status: 'draft', data: invoiceData({ issueDate: '2026-03-15' }) }),
    ]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv).toBe(HEADER);
  });

  it('a CANCELLED invoice never appears — TODO_CORRECTION.md C3, nothing owed on a void document', async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'void-1', status: 'cancelled', data: invoiceData({ issueDate: '2026-03-15' }) }),
    ]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv).toBe(HEADER);
  });

  it('issueDate range boundaries are inclusive', async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'first-day', data: invoiceData({ issueDate: '2026-03-01' }) }),
      invoice({ id: 'last-day', data: invoiceData({ issueDate: '2026-03-31' }) }),
    ]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv.split('\n')).toHaveLength(3); // header + both invoices
  });

  it("a partially paid invoice's status is 'outstanding'; a fully paid one is 'settled' — computeSettlement, never re-derived", async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'partial', data: invoiceData({ issueDate: '2026-03-15' }) }),
      invoice({ id: 'full', data: invoiceData({ issueDate: '2026-03-16' }) }),
    ]);
    sumPaidMinorByDocument.mockResolvedValue(
      new Map([
        ['partial', 5000],
        ['full', 18000],
      ]),
    );

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    const lines = csv.split('\n').slice(1);

    expect(lines.find((line) => line.includes('2026-03-15'))).toContain('outstanding');
    expect(lines.find((line) => line.includes('2026-03-16'))).toContain('settled');
  });

  it("resolves the invoice's client id to a real label, in one batched call", async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-03-15' }) })]);
    resolveClientLabels.mockResolvedValue(new Map([['client-1', 'Acme Corp']]));

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');

    expect(csv.split('\n')[1]).toContain('Acme Corp');
    expect(resolveClientLabels).toHaveBeenCalledWith('company-1', ['client-1']);
  });
});

describe('buildAccountingExport — credit notes', () => {
  it("a credit note's OWN issueDate governs, independent of its invoice's issueDate", async () => {
    // The invoice was issued in FEBRUARY (outside this export's March period) — but the credit note
    // correcting it was issued in March, so only the credit note appears.
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-02-01' }) })]);
    listCreditNotes.mockResolvedValue([
      creditNote({
        data: { invoice: 'inv-1', issueDate: '2026-03-10', currency: 'EUR', correctedLines: ['line-2'] },
      }),
    ]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2); // header + the credit note only, never the (out-of-period) invoice
    // 50 EUR net, 20% VAT -> 60.00 gross for the ONE selected line — settlement/credits.ts's own
    // `computeCreditedAmountMinor`, never re-derived here.
    expect(lines[1]).toBe('credit-note,CN-2026-0001,2026-03-10,client-1,EUR,,,60.00,,,settled');
  });

  it('a credit note pointing at an unresolvable invoice contributes nothing — skipped, no crash', async () => {
    listDocuments.mockResolvedValue([]); // the invoice it names doesn't exist in this company's set
    listCreditNotes.mockResolvedValue([
      creditNote({ data: { invoice: 'ghost-invoice', issueDate: '2026-03-10', currency: 'EUR' } }),
    ]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv).toBe(HEADER);
  });
});

describe('buildAccountingExport — payments', () => {
  it("a payment inside the period appears, using documentAmountMinor and the document's own currency", async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-01-01' }) })]); // out of period
    listPaymentsInRange.mockResolvedValue([
      // A converted payment: 100.00 USD received, pinned at 92.00 EUR against the (EUR) invoice.
      payment({
        amountMinor: 10000,
        currency: 'USD',
        documentAmountMinor: 9200,
        paidAt: new Date('2026-03-25'),
      }),
    ]);
    findOwnedDocumentsByIds.mockResolvedValue([invoice({ data: invoiceData({ issueDate: '2026-01-01' }) })]);

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2); // header + the payment only (the invoice itself is out of period)
    // paid = 92.00 EUR (documentAmountMinor/EUR), NEVER 100.00 USD (the raw amountMinor/currency).
    expect(lines[1]).toBe('payment,INV-2026-0001,2026-03-25,client-1,EUR,,,,92.00,bank_transfer,');
  });

  it('a payment whose paidAt is outside the period never appears — listPaymentsInRange already filtered it, but prove the plumbing', async () => {
    listPaymentsInRange.mockResolvedValue([]); // the mock IS the filter — this proves the call site uses it
    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv).toBe(HEADER);
    expect(listPaymentsInRange).toHaveBeenCalledWith(
      'company-1',
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-03-31T23:59:59.999Z'),
    );
  });

  it('a payment with no resolvable document still appears, falling back to the raw documentId as its reference', async () => {
    listPaymentsInRange.mockResolvedValue([payment({ documentId: 'deleted-doc' })]);
    findOwnedDocumentsByIds.mockResolvedValue([]); // the document is gone

    const csv = await buildAccountingExport('company-1', '2026-03-01', '2026-03-31');
    expect(csv.split('\n')[1]).toContain('deleted-doc');
  });
});

describe('buildAccountingExport — scoping', () => {
  it('scopes every read by the given companyId', async () => {
    await buildAccountingExport('company-42', '2026-03-01', '2026-03-31');

    expect(listDocuments).toHaveBeenCalledWith('company-42', 'invoice', expect.any(Number));
    expect(listCreditNotes).toHaveBeenCalledWith('company-42');
    expect(sumPaidMinorByDocument).toHaveBeenCalledWith('company-42', []);
    expect(listPaymentsInRange).toHaveBeenCalledWith('company-42', expect.any(Date), expect.any(Date));
  });
});

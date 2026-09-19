import { vi, type Mock } from 'vitest';

import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import * as clientLabels from '../accounting-export/client-labels';
import * as persistence from '../persistence';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { resolveOutstandingInvoices } from './candidate-invoices';

/**
 * Same mocking discipline as `settlement/client-statement.spec.ts` (this file's own model): `../
 * persistence` and `../settlement/payments` fully mocked (both reach Prisma directly), `../settlement/
 * credits` mocked ONLY for `listCreditNotes` — `creditsForInvoiceFromNotes`/`toSettlementCreditInputs`
 * stay the real, already-proven implementation.
 */
vi.mock('../persistence');
vi.mock('../settlement/payments');
vi.mock('../settlement/credits', async () => {
  const actual = await vi.importActual('../settlement/credits');
  return { ...actual, listCreditNotes: vi.fn() };
});
vi.mock('../accounting-export/client-labels');

const listDocuments = persistence.listDocuments as Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as Mock;
const listCreditNotes = settlementCredits.listCreditNotes as Mock;
const resolveClientLabels = clientLabels.resolveClientLabels as Mock;

// 100 EUR net, 20% VAT -> 120 gross (12000 minor) — the same minimal fixture
// `settlement/client-statement.spec.ts` already uses.
function invoiceData(overrides: Record<string, unknown> = {}) {
  return {
    client: 'client-1',
    issueDate: '2026-08-01',
    dueDate: '2026-08-31',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '20' }],
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
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  };
}

beforeEach(() => {
  listDocuments.mockReset();
  sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
  listCreditNotes.mockReset().mockResolvedValue([]);
  resolveClientLabels.mockReset().mockResolvedValue(new Map([['client-1', 'ACME SARL']]));
});

describe('resolveOutstandingInvoices', () => {
  it('a sent, unpaid invoice is a candidate with its full gross as outstanding', async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);

    const candidates = await resolveOutstandingInvoices('company-1');
    expect(candidates).toEqual([
      {
        documentId: 'inv-1',
        displayNumber: 'INV-2026-0001',
        clientLabel: 'ACME SARL',
        currency: 'EUR',
        outstandingMinor: 12000,
        issueDate: '2026-08-01',
        dueDate: '2026-08-31',
      },
    ]);
  });

  it('a draft invoice is never a candidate — nothing owed on record yet', async () => {
    listDocuments.mockResolvedValue([invoice({ id: 'inv-draft', status: 'draft', data: invoiceData() })]);
    expect(await resolveOutstandingInvoices('company-1')).toEqual([]);
  });

  it('a fully paid invoice is never a candidate — nothing left to reconcile', async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-1', 12000]]));
    expect(await resolveOutstandingInvoices('company-1')).toEqual([]);
  });

  it('a partially paid invoice is still a candidate, for its REMAINING balance', async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-1', 5000]]));
    const candidates = await resolveOutstandingInvoices('company-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].outstandingMinor).toBe(7000);
  });

  it('a client id with no resolvable label degrades to null, never a crash', async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    resolveClientLabels.mockResolvedValue(new Map());
    const candidates = await resolveOutstandingInvoices('company-1');
    expect(candidates[0].clientLabel).toBeNull();
  });
});

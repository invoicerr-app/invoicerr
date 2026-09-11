import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import * as persistence from '../persistence';
import * as settlementCredits from './credits';
import * as settlementPayments from './payments';
import { resolveAgingBucket, resolveClientStatement } from './client-statement';

/**
 * TODO_FEATURES.md rank 6 ("relevé de compte client") — same mocking discipline as
 * contributions/invoice-contributions.spec.ts (this file's own model): `../persistence` and
 * `./payments` fully mocked (both reach Prisma directly), `./credits` mocked ONLY for
 * `listCreditNotes` (the one function here that reaches Prisma) — `creditsForInvoiceFromNotes`/
 * `toSettlementCreditInputs` stay the REAL, already-proven implementation (credits.spec.ts), so this
 * file never re-litigates rules that module already owns (currency-mismatch warnings, draft
 * exclusion, …).
 */
jest.mock('../persistence');
jest.mock('./payments');
jest.mock('./credits', () => {
  const actual = jest.requireActual('./credits');
  return { ...actual, listCreditNotes: jest.fn() };
});

const listDocuments = persistence.listDocuments as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;

// Two lines: 100 EUR net (20% VAT -> 120 gross, 12000 minor) and 50 EUR net (20% VAT -> 60 gross,
// 6000 minor) — full gross 18000 minor, same fixture as credits.spec.ts, reused verbatim.
function invoiceData(overrides: Record<string, unknown> = {}) {
  return {
    client: 'client-1',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
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
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    ...overrides,
  };
}

beforeEach(() => {
  listDocuments.mockReset();
  sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
  listCreditNotes.mockReset().mockResolvedValue([]);
});

describe('resolveAgingBucket', () => {
  const asOf = new Date('2026-06-01T00:00:00Z');

  it('a due date in the future is "current" — not yet due', () => {
    expect(resolveAgingBucket('2026-06-02', asOf)).toBe('current');
  });

  it('due exactly on the as-of date is "0-30", not "current"', () => {
    expect(resolveAgingBucket('2026-06-01', asOf)).toBe('0-30');
  });

  it('30 days overdue is still "0-30" (inclusive upper bound)', () => {
    expect(resolveAgingBucket('2026-05-02', asOf)).toBe('0-30');
  });

  it('31 days overdue crosses into "31-60"', () => {
    expect(resolveAgingBucket('2026-05-01', asOf)).toBe('31-60');
  });

  // The task's own worked example: overdue 40 days -> 31-60, overdue 70 days -> 60+.
  it('40 days overdue is "31-60"', () => {
    const dueDate = new Date(asOf.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);
    expect(resolveAgingBucket(dueDate, asOf)).toBe('31-60');
  });

  it('60 days overdue is still "31-60" (inclusive upper bound)', () => {
    expect(resolveAgingBucket('2026-04-02', asOf)).toBe('31-60');
  });

  it('61 days overdue crosses into "60+"', () => {
    expect(resolveAgingBucket('2026-04-01', asOf)).toBe('60+');
  });

  it('70 days overdue is "60+"', () => {
    const dueDate = new Date(asOf.getTime() - 70 * 86_400_000).toISOString().slice(0, 10);
    expect(resolveAgingBucket(dueDate, asOf)).toBe('60+');
  });

  it('a missing due date degrades to "current" rather than guessing or throwing', () => {
    expect(resolveAgingBucket(null, asOf)).toBe('current');
    expect(resolveAgingBucket(undefined, asOf)).toBe('current');
  });

  it('an unparseable due date degrades to "current" the same way', () => {
    expect(resolveAgingBucket('not-a-date', asOf)).toBe('current');
  });
});

describe('resolveClientStatement', () => {
  const ASOF = new Date('2026-06-01T00:00:00Z');

  it("a partially paid, partially credited invoice's outstanding balance = amount - payments - credits", async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-1', 5000]]));
    listCreditNotes.mockResolvedValue([
      creditNote({ data: { invoice: 'inv-1', currency: 'EUR', correctedLines: ['line-2'] } }),
    ]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    const invoiceRow = statement.documents.find((doc) => doc.id === 'inv-1')!;
    // 18000 (gross) - 5000 (paid) - 6000 (credited line-2) = 7000.
    expect(invoiceRow.amountMinor).toBe(18000);
    expect(invoiceRow.paidMinor).toBe(5000);
    expect(invoiceRow.outstandingMinor).toBe(7000);
    expect(invoiceRow.settled).toBe(false);

    const creditRow = statement.documents.find((doc) => doc.id === 'cn-1')!;
    expect(creditRow.typeId).toBe('credit-note');
    expect(creditRow.amountMinor).toBe(6000);
    // A credit note carries no independent balance of its own — it already reduced the invoice's
    // own outstandingMinor above; it must never ALSO show up as something owed on its own row.
    expect(creditRow.paidMinor).toBe(0);
    expect(creditRow.outstandingMinor).toBe(0);
    expect(creditRow.settled).toBe(true);
    expect(creditRow.dueDate).toBeNull();

    expect(statement.totals).toEqual([
      expect.objectContaining({ currency: 'EUR', totalOutstandingMinor: 7000 }),
    ]);
  });

  it('a fully paid invoice is settled, with a zero outstanding balance', async () => {
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-1', 18000]]));

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    const invoiceRow = statement.documents[0];
    expect(invoiceRow.outstandingMinor).toBe(0);
    expect(invoiceRow.settled).toBe(true);
    expect(statement.totals[0].totalOutstandingMinor).toBe(0);
  });

  it("the total per currency is the SUM of every counted invoice's own outstanding balance", async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'inv-1', data: invoiceData({ dueDate: '2026-05-01' }) }), // 18000 outstanding
      invoice({ id: 'inv-2', data: invoiceData({ dueDate: '2026-05-15' }) }), // 18000 outstanding
    ]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-2', 8000]])); // inv-2: 18000-8000=10000

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.totals).toEqual([
      expect.objectContaining({ currency: 'EUR', totalOutstandingMinor: 18000 + 10000 }),
    ]);
  });

  it("places each invoice's outstanding balance in the correct aged bucket, by its own due date", async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'not-due', data: invoiceData({ dueDate: '2026-07-01' }) }),
      invoice({ id: 'overdue-40', data: invoiceData({ dueDate: '2026-04-22' }) }), // 40 days overdue
      invoice({ id: 'overdue-70', data: invoiceData({ dueDate: '2026-03-23' }) }), // 70 days overdue
    ]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);
    const totals = statement.totals[0];

    expect(totals.currentMinor).toBe(18000); // "not-due"
    expect(totals.days0to30Minor).toBe(0);
    expect(totals.days31to60Minor).toBe(18000); // "overdue-40"
    expect(totals.days60PlusMinor).toBe(18000); // "overdue-70"
    expect(totals.totalOutstandingMinor).toBe(18000 * 3);
  });

  it('never mixes currencies into one total — one entry per currency', async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'inv-eur', data: invoiceData({ currency: 'EUR' }) }),
      invoice({ id: 'inv-usd', data: invoiceData({ currency: 'USD' }) }),
    ]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.totals).toEqual([
      expect.objectContaining({ currency: 'EUR', totalOutstandingMinor: 18000 }),
      expect.objectContaining({ currency: 'USD', totalOutstandingMinor: 18000 }),
    ]);
  });

  it('excludes a DRAFT invoice — never issued, nothing legally owed yet', async () => {
    listDocuments.mockResolvedValue([invoice({ id: 'draft-1', status: 'draft', data: invoiceData() })]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.documents).toEqual([]);
    expect(statement.totals).toEqual([]);
  });

  it('excludes a CANCELLED invoice — TODO_CORRECTION.md C3, nothing is owed on a void document', async () => {
    listDocuments.mockResolvedValue([invoice({ id: 'void-1', status: 'cancelled', data: invoiceData() })]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.documents).toEqual([]);
  });

  // Isolation — the concern this whole task exists to protect (an audit finding, per CLAUDE.md).
  it("never includes another CLIENT's invoice, even for the same company", async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'mine', data: invoiceData({ client: 'client-1' }) }),
      invoice({ id: 'someone-elses', data: invoiceData({ client: 'client-2' }) }),
    ]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.documents.map((doc) => doc.id)).toEqual(['mine']);
  });

  it("a credit note correcting a DIFFERENT client's invoice never leaks onto this statement", async () => {
    listDocuments.mockResolvedValue([invoice({ id: 'mine', data: invoiceData({ client: 'client-1' }) })]);
    listCreditNotes.mockResolvedValue([
      creditNote({
        id: 'not-mine',
        data: { invoice: 'someone-elses-invoice', currency: 'EUR', correctedLines: ['line-1'] },
      }),
    ]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement.documents.map((doc) => doc.id)).toEqual(['mine']);
  });

  // Scoping — `listDocuments`/`listCreditNotes`/`sumPaidMinorByDocument` are what actually enforce
  // tenant isolation at the Prisma layer (persistence.ts's own header); this proves this function
  // never drops or swaps the `companyId` it was given on the way to them — a mutation deleting this
  // argument, or passing the clientId instead, fails this test.
  it('scopes every read by the given companyId', async () => {
    listDocuments.mockResolvedValue([]);

    await resolveClientStatement('company-42', 'client-1', ASOF);

    expect(listDocuments).toHaveBeenCalledWith('company-42', 'invoice', expect.any(Number));
    expect(listCreditNotes).toHaveBeenCalledWith('company-42');
    expect(sumPaidMinorByDocument).toHaveBeenCalledWith('company-42', []);
  });

  it('an empty result for a client with no "sent" invoice at all', async () => {
    listDocuments.mockResolvedValue([]);

    const statement = await resolveClientStatement('company-1', 'client-1', ASOF);

    expect(statement).toEqual({ clientId: 'client-1', documents: [], totals: [] });
  });
});

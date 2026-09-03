import {
  buildInvoiceDashboardWidgets,
  buildInvoiceStatisticsWidgets,
  invoiceTotal,
} from './invoice-contributions';
import * as persistence from '../persistence';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import { ShortListWidget, TableWidget, TimeSeriesWidget } from './widgets';

jest.mock('../persistence');
// The "pending" shortList below now excludes SETTLED invoices (settlement/) — mocked here the same
// way `../persistence` already is, defaulting to "nothing paid" so every pre-existing test in this
// file keeps meaning exactly what it always did.
jest.mock('../settlement/payments');
// Same reason, same discipline, for CREDITS (item 8, "le lettrage") — `listCreditNotes` also reaches
// Prisma directly. Defaulted to "no credit notes at all" so every pre-existing test keeps meaning
// exactly what it always did; the dedicated test below overrides it.
jest.mock('../settlement/credits', () => {
  const actual = jest.requireActual('../settlement/credits');
  return { ...actual, listCreditNotes: jest.fn() };
});

const listDocuments = persistence.listDocuments as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;

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

describe('invoiceTotal', () => {
  it('sums quantity * unitPrice across the lines, arithmetic only', () => {
    const total = invoiceTotal({
      lines: [
        { description: 'A', quantity: 2, unitPrice: 10 },
        { description: 'B', quantity: 1, unitPrice: 5.5 },
      ],
    });
    expect(total).toBeCloseTo(25.5);
  });

  it('treats a missing quantity/unitPrice as 0 rather than throwing — a draft-in-progress is normal', () => {
    expect(invoiceTotal({ lines: [{ description: 'A' }] })).toBe(0);
    expect(invoiceTotal({})).toBe(0);
  });
});

describe('buildInvoiceDashboardWidgets', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30'));
    listDocuments.mockReset();
    sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
    listCreditNotes.mockReset().mockResolvedValue([]);
  });

  afterEach(() => jest.useRealTimers());

  it('lists only "sent" invoices as pending, sorted by due date, with an arithmetic total', async () => {
    listDocuments.mockResolvedValue([
      invoice({
        id: 'draft-1',
        status: 'draft',
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'sent-2',
        status: 'sent',
        data: { currency: 'EUR', dueDate: '2026-09-10', lines: [{ quantity: 2, unitPrice: 50 }] },
      }),
      invoice({
        id: 'sent-1',
        status: 'sent',
        data: { currency: 'USD', dueDate: '2026-09-05', lines: [{ quantity: 1, unitPrice: 30 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(pending).toBeDefined();
    // Only the two "sent" invoices — the draft is excluded — sorted by due date ascending.
    expect(pending.items.map((i) => i.id)).toEqual(['sent-1', 'sent-2']);
    expect(pending.items[0]).toMatchObject({ primary: '30.00 USD', secondary: '2026-09-05' });
    expect(pending.items[1]).toMatchObject({ primary: '100.00 EUR', secondary: '2026-09-10' });
  });

  it('excludes a "cancelled" invoice — TODO_CORRECTION.md C3, a void invoice owes nothing and is never pending', async () => {
    listDocuments.mockResolvedValue([
      invoice({
        id: 'cancelled-1',
        status: 'cancelled',
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 500 }] },
      }),
      invoice({
        id: 'sent-1',
        status: 'sent',
        data: { currency: 'EUR', dueDate: '2026-09-10', lines: [{ quantity: 1, unitPrice: 50 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;
    const totals = widgets.filter(
      (w) => w.kind === 'metric' && w.id.startsWith('invoice:pending-total:'),
    ) as { id: string; value: number }[];

    // The cancelled invoice's own 500 EUR never shows up as pending, and never inflates the
    // "pending invoices total (EUR)" metric either — only the genuinely "sent" one does.
    expect(pending.items.map((i) => i.id)).toEqual(['sent-1']);
    expect(totals.find((t) => t.id === 'invoice:pending-total:EUR')?.value).toBe(50);
  });

  it('excludes a "sent" invoice that has been SETTLED — a paid invoice is no longer pending', async () => {
    listDocuments.mockResolvedValue([
      invoice({
        id: 'settled-1',
        status: 'sent',
        // No vatRate given: grossMinor === netMinor === 1 * 10000 minor (100.00 EUR).
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'partial-1',
        status: 'sent',
        data: { currency: 'EUR', dueDate: '2026-09-02', lines: [{ quantity: 1, unitPrice: 200 }] },
      }),
    ]);
    sumPaidMinorByDocument.mockResolvedValue(
      new Map([
        ['settled-1', 10000], // paid in full — excluded
        ['partial-1', 5000], // half paid — still pending
      ]),
    );

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(pending.items.map((i) => i.id)).toEqual(['partial-1']);
    expect(sumPaidMinorByDocument).toHaveBeenCalledWith('c1', ['settled-1', 'partial-1']);
  });

  it('excludes a "sent" invoice that has been fully CREDITED — item 8, "le lettrage" — same function, automatically', async () => {
    // credited-1: one 100 EUR line, no VAT rate given -> grossMinor 10000, corrected in FULL by a
    // SENT credit note selecting that same line. still-pending-1: correctable line untouched by any
    // credit note at all.
    listDocuments.mockResolvedValue([
      invoice({
        id: 'credited-1',
        status: 'sent',
        data: {
          currency: 'EUR',
          dueDate: '2026-09-01',
          lines: [{ [ROW_ID_KEY]: 'line-1', quantity: 1, unitPrice: 100 }],
        },
      }),
      invoice({
        id: 'still-pending-1',
        status: 'sent',
        data: {
          currency: 'EUR',
          dueDate: '2026-09-02',
          lines: [{ [ROW_ID_KEY]: 'line-2', quantity: 1, unitPrice: 200 }],
        },
      }),
    ]);
    listCreditNotes.mockResolvedValue([
      {
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'sent',
        displayNumber: null,
        data: { invoice: 'credited-1', currency: 'EUR', correctedLines: ['line-1'] },
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
      },
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    // No `computeSettlement`/credits logic was duplicated here — the SAME function this dashboard
    // already reused for payments is what excludes `credited-1`, "gratuit" per the task's own wording.
    expect(pending.items.map((i) => i.id)).toEqual(['still-pending-1']);
  });

  it('counts invoices per issue month over the trailing window — never sums their amounts', async () => {
    listDocuments.mockResolvedValue([
      invoice({
        id: 'i1',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-05', lines: [{ quantity: 1, unitPrice: 1000 }] },
      }),
      invoice({
        id: 'i2',
        status: 'sent',
        // A DIFFERENT currency in the SAME month — if the curve ever summed amounts, mixing EUR and
        // USD here would silently produce a meaningless number. It must not: this only counts.
        data: { currency: 'USD', issueDate: '2026-08-20', lines: [{ quantity: 1, unitPrice: 1 }] },
      }),
      invoice({
        id: 'i3',
        status: 'draft',
        data: { currency: 'EUR', issueDate: '2026-07-01', lines: [{ quantity: 1, unitPrice: 1 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const curve = widgets.find((w) => w.kind === 'timeSeries') as TimeSeriesWidget;

    expect(curve).toBeDefined();
    expect(curve.points).toHaveLength(6); // the fixed 6-month window
    const august = curve.points[curve.points.length - 1];
    const july = curve.points[curve.points.length - 2];
    // August 2026 got 2 invoices (i1, i2) regardless of their different currencies and wildly
    // different amounts (1000 vs 1) — a count, never a sum.
    expect(august.value).toBe(2);
    expect(july.value).toBe(1);
  });

  it('an invoice with no parseable issueDate is skipped by the curve rather than crashing it', async () => {
    listDocuments.mockResolvedValue([
      invoice({ id: 'bad', status: 'sent', data: { currency: 'EUR', issueDate: 'not-a-date', lines: [] } }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const curve = widgets.find((w) => w.kind === 'timeSeries') as TimeSeriesWidget;
    expect(curve.points.every((p) => p.value === 0)).toBe(true);
  });
});

describe('buildInvoiceStatisticsWidgets', () => {
  beforeEach(() => listDocuments.mockReset());

  it('renders one detailed row per invoice, and a total count metric', async () => {
    listDocuments.mockResolvedValue([
      invoice({
        id: 'a',
        status: 'sent',
        data: {
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          currency: 'EUR',
          lines: [{ quantity: 2, unitPrice: 10 }],
        },
      }),
      invoice({
        id: 'b',
        status: 'draft',
        data: { issueDate: '2026-02-01', dueDate: '2026-03-01', currency: 'USD', lines: [] },
      }),
      // TODO_CORRECTION.md C3 — unlike the dashboard's own "pending" list (see the dedicated
      // exclusion test above), the full audit table keeps a "cancelled" invoice, exactly like
      // "draft"/"send_failed" already are — this is a record of every invoice ever issued, not a
      // worklist of what is still owed.
      invoice({
        id: 'c',
        status: 'cancelled',
        data: {
          issueDate: '2026-03-01',
          dueDate: '2026-03-31',
          currency: 'EUR',
          lines: [{ quantity: 1, unitPrice: 500 }],
        },
      }),
    ]);

    const widgets = await buildInvoiceStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;
    const metric = widgets.find((w) => w.kind === 'metric');

    expect(metric).toMatchObject({ value: 3 });
    expect(table.rows).toEqual([
      { issueDate: '2026-01-01', dueDate: '2026-01-31', status: 'sent', currency: 'EUR', total: 20 },
      { issueDate: '2026-02-01', dueDate: '2026-03-01', status: 'draft', currency: 'USD', total: 0 },
      { issueDate: '2026-03-01', dueDate: '2026-03-31', status: 'cancelled', currency: 'EUR', total: 500 },
    ]);
  });
});

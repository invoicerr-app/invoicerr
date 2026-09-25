import { vi, type Mock } from 'vitest';

import {
  buildInvoiceDashboardWidgets,
  buildInvoiceStatisticsWidgets,
  invoiceTotal,
  monthsSpanning,
} from './invoice-contributions';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import { ShortListWidget, TableWidget, TimeSeriesWidget } from './widgets';

// `dayMs`/`dateValueInRange` are kept REAL (issue #418's own period-restriction helper reuses them
// directly, not through a mocked module) - only the actual DB reads below are faked. A blanket
// `vi.mock('../persistence')` would auto-mock those two pure functions into no-ops returning
// `undefined`, which `dateValueInRange` treats as "unparseable -> excluded", silently emptying every
// period-scoped fixture below regardless of its own dates.
vi.mock('../persistence', async () => {
  const actual = await vi.importActual<typeof import('../persistence')>('../persistence');
  return { ...actual, listAllDocuments: vi.fn(), listRecentDocuments: vi.fn(), countDocuments: vi.fn() };
});
// The "pending" shortList below now excludes SETTLED invoices (settlement/) - mocked here the same
// way `../persistence` already is, defaulting to "nothing paid" so every pre-existing test in this
// file keeps meaning exactly what it always did.
vi.mock('../settlement/payments');
// Same reason, same discipline, for CREDITS (credit matching) — `listCreditNotes` also reaches
// Prisma directly. Defaulted to "no credit notes at all" so every pre-existing test keeps meaning
// exactly what it always did; the dedicated test below overrides it.
vi.mock('../settlement/credits', async () => {
  const actual = await vi.importActual('../settlement/credits');
  return { ...actual, listCreditNotes: vi.fn() };
});

const listAllDocuments = persistence.listAllDocuments as Mock;
const listRecentDocuments = persistence.listRecentDocuments as Mock;
const countDocuments = persistence.countDocuments as Mock;

/** Hands the code under test only the rows the QUERY would have returned. The narrowing moved into
 *  SQL when these reads stopped being capped, and the statistics screen now counts in the table
 *  rather than on its own page — so one fixture feeds all three reads. Fixtures here stay small on
 *  purpose; the cap-crossing ones live in `*.read-cap.spec.ts`. */
function seedDocuments(rows: DocumentInstanceResult[]): void {
  listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
    filterLikeListAllDocuments(rows, options),
  );
  listRecentDocuments.mockImplementation(async (_companyId: string, options) =>
    filterLikeListAllDocuments(rows, {
      typeId: options.typeId,
      status: options.status,
      orderBy: { field: 'updatedAt', direction: 'desc' },
    }).slice(0, options.take),
  );
  countDocuments.mockImplementation(
    async (_companyId: string, typeId?: string, status?: string[]) =>
      filterLikeListAllDocuments(rows, { typeId, status }).length,
  );
}

const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as Mock;
const listCreditNotes = settlementCredits.listCreditNotes as Mock;

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
    vi.useFakeTimers().setSystemTime(new Date('2026-08-30'));
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
    sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
    listCreditNotes.mockReset().mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it('lists only "sent" invoices as pending, sorted by due date, with an arithmetic total', async () => {
    seedDocuments([
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
    // The structured facts a dashboard row is drawn from: status badge, due date, right-aligned
    // amount in the record's own currency — and the type that lets the row open the record.
    expect(pending.documentTypeId).toBe('invoice');
    expect(pending.items[0]).toMatchObject({
      status: 'sent',
      dueDate: '2026-09-05',
      amount: { value: 30, currency: 'USD' },
    });
  });

  it('titles a pending row with the invoice NUMBER once it has one — the amount stays structured', async () => {
    seedDocuments([
      invoice({
        id: 'sent-1',
        status: 'sent',
        displayNumber: 'INV-2026-0007',
        data: { currency: 'EUR', dueDate: '2026-09-10', lines: [{ quantity: 2, unitPrice: 50 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(pending.items[0]).toMatchObject({
      primary: 'INV-2026-0007',
      amount: { value: 100, currency: 'EUR' },
    });
  });

  it('totals OVERDUE pending invoices per currency — due yesterday counts, due today does not', async () => {
    // System time is 2026-08-30 (see beforeEach).
    seedDocuments([
      invoice({
        id: 'late',
        status: 'sent',
        data: { currency: 'EUR', dueDate: '2026-08-29', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'due-today',
        status: 'sent',
        data: { currency: 'EUR', dueDate: '2026-08-30', lines: [{ quantity: 1, unitPrice: 40 }] },
      }),
      invoice({
        id: 'usd-on-time',
        status: 'sent',
        data: { currency: 'USD', dueDate: '2026-09-15', lines: [{ quantity: 1, unitPrice: 30 }] },
      }),
      // Late but a DRAFT: never pending, so never overdue either.
      invoice({
        id: 'late-draft',
        status: 'draft',
        data: { currency: 'EUR', dueDate: '2026-01-01', lines: [{ quantity: 1, unitPrice: 999 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });

    expect(widgets.find((w) => w.id === 'invoice:overdue-total:EUR')).toMatchObject({
      kind: 'metric',
      unit: 'EUR',
      value: 100,
    });
    // A currency with pending invoices but nothing late still gets its tile — a 0 says
    // "nothing late", a missing tile says nothing.
    expect(widgets.find((w) => w.id === 'invoice:overdue-total:USD')).toMatchObject({ value: 0 });
    expect(widgets.find((w) => w.id === 'invoice:overdue-total')).toBeUndefined();
  });

  it('nothing pending at all: ONE currency-less overdue zero, never a guessed currency', async () => {
    seedDocuments([]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });

    expect(widgets.find((w) => w.id === 'invoice:overdue-total')).toMatchObject({ kind: 'metric', value: 0 });
    expect(widgets.find((w) => w.id === 'invoice:overdue-total')).not.toHaveProperty('unit');
  });

  it('sums what was INVOICED this month per currency, next to last month — "sent" only', async () => {
    // System time is 2026-08-30: this month = 2026-08, last month = 2026-07.
    seedDocuments([
      invoice({
        id: 'aug-1',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-05', lines: [{ quantity: 1, unitPrice: 300 }] },
      }),
      invoice({
        id: 'aug-2',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-20', lines: [{ quantity: 2, unitPrice: 100 }] },
      }),
      invoice({
        id: 'jul-1',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-07-11', lines: [{ quantity: 1, unitPrice: 250 }] },
      }),
      // Same month, other currency: its own tile, never added into EUR's.
      invoice({
        id: 'aug-usd',
        status: 'sent',
        data: { currency: 'USD', issueDate: '2026-08-08', lines: [{ quantity: 1, unitPrice: 70 }] },
      }),
      // Not issued: a draft, a cancelled (void) one, a failed send — all dated this month, all excluded.
      invoice({
        id: 'aug-draft',
        status: 'draft',
        data: { currency: 'EUR', issueDate: '2026-08-09', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
      invoice({
        id: 'aug-cancelled',
        status: 'cancelled',
        data: { currency: 'EUR', issueDate: '2026-08-10', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
      invoice({
        id: 'aug-failed',
        status: 'send_failed',
        data: { currency: 'EUR', issueDate: '2026-08-12', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
      // Two months back: outside both windows.
      invoice({
        id: 'jun-1',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-06-01', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });

    expect(widgets.find((w) => w.id === 'invoice:issued-this-month:EUR')).toMatchObject({
      kind: 'metric',
      unit: 'EUR',
      value: 500,
      previousValue: 250,
    });
    expect(widgets.find((w) => w.id === 'invoice:issued-this-month:USD')).toMatchObject({
      value: 70,
      previousValue: 0,
    });
    expect(widgets.find((w) => w.id === 'invoice:issued-this-month')).toBeUndefined();
  });

  it('nothing invoiced this month or last: ONE currency-less zero, no previous value', async () => {
    seedDocuments([]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const zero = widgets.find((w) => w.id === 'invoice:issued-this-month');

    expect(zero).toMatchObject({ kind: 'metric', value: 0 });
    expect(zero).not.toHaveProperty('unit');
    expect(zero).not.toHaveProperty('previousValue');
  });

  it('excludes a "cancelled" invoice — a void invoice owes nothing and is never pending', async () => {
    seedDocuments([
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
    seedDocuments([
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

  it('excludes a "sent" invoice that has been fully CREDITED — "le lettrage" — same function, automatically', async () => {
    // credited-1: one 100 EUR line, no VAT rate given -> grossMinor 10000, corrected in FULL by a
    // SENT credit note selecting that same line. still-pending-1: correctable line untouched by any
    // credit note at all.
    seedDocuments([
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
    // already reused for payments is what excludes `credited-1`, "free" per the task's own wording.
    expect(pending.items.map((i) => i.id)).toEqual(['still-pending-1']);
  });

  it('counts invoices per issue month over the trailing window — never sums their amounts', async () => {
    seedDocuments([
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
    seedDocuments([
      invoice({ id: 'bad', status: 'sent', data: { currency: 'EUR', issueDate: 'not-a-date', lines: [] } }),
    ]);

    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1' });
    const curve = widgets.find((w) => w.kind === 'timeSeries') as TimeSeriesWidget;
    expect(curve.points.every((p) => p.value === 0)).toBe(true);
  });
});

// Issue #418: a period restricts every period-aware figure to invoices whose OWN `issueDate` falls
// within it - the exact same field/comparison `GET /documents`'s own `dateFrom`/`dateTo` filter
// applies (THE CONSISTENCY RULE), so a tile and the list its `link` opens always agree.
describe('buildInvoiceDashboardWidgets with a period set', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-30'));
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
    sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
    listCreditNotes.mockReset().mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it('"pending"/"pending-total"/"overdue-total" only count invoices whose issueDate is IN the period', async () => {
    seedDocuments([
      invoice({
        id: 'in-period',
        status: 'sent',
        data: {
          currency: 'EUR',
          issueDate: '2026-08-15',
          dueDate: '2026-08-01', // already overdue, system time 2026-08-30
          lines: [{ quantity: 1, unitPrice: 100 }],
        },
      }),
      invoice({
        id: 'before-period',
        status: 'sent',
        data: {
          currency: 'EUR',
          issueDate: '2026-07-31', // one day before the period
          dueDate: '2026-08-01',
          lines: [{ quantity: 1, unitPrice: 999 }],
        },
      }),
      invoice({
        id: 'after-period',
        status: 'sent',
        data: {
          currency: 'EUR',
          issueDate: '2026-09-01', // one day after the period
          dueDate: '2026-08-01',
          lines: [{ quantity: 1, unitPrice: 999 }],
        },
      }),
    ]);

    const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1', period });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(pending.items.map((i) => i.id)).toEqual(['in-period']);
    expect(widgets.find((w) => w.id === 'invoice:pending-total:EUR')).toMatchObject({ value: 100 });
    expect(widgets.find((w) => w.id === 'invoice:overdue-total:EUR')).toMatchObject({ value: 100 });
  });

  it('boundary dates are inclusive on both ends', async () => {
    seedDocuments([
      invoice({
        id: 'first-day',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-01', lines: [{ quantity: 1, unitPrice: 10 }] },
      }),
      invoice({
        id: 'last-day',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-31', lines: [{ quantity: 1, unitPrice: 20 }] },
      }),
    ]);

    const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1', period });
    const pending = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(pending.items.map((i) => i.id).sort()).toEqual(['first-day', 'last-day']);
  });

  it('every link carries the period, merged with its existing status/settlement', async () => {
    seedDocuments([
      invoice({
        id: 'a',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-15', dueDate: '2026-08-01', lines: [] },
      }),
    ]);

    const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1', period });

    const overdueTotal = widgets.find((w) => w.id === 'invoice:overdue-total');
    expect((overdueTotal as MetricWidget).link).toMatchObject({
      typeId: 'invoice',
      status: ['sent'],
      settlement: 'overdue',
      ...period,
    });

    const issued = widgets.find((w) => w.id.startsWith('invoice:issued-in-period'));
    expect((issued as MetricWidget).link).toMatchObject({ typeId: 'invoice', status: ['sent'], ...period });
  });

  it('"issued in period" sums sent invoices in the period, under a distinct id, with no previousValue', async () => {
    seedDocuments([
      invoice({
        id: 'sent-in-period',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-10', lines: [{ quantity: 1, unitPrice: 300 }] },
      }),
      invoice({
        id: 'draft-in-period',
        status: 'draft',
        data: { currency: 'EUR', issueDate: '2026-08-11', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
      invoice({
        id: 'sent-outside-period',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-07-01', lines: [{ quantity: 1, unitPrice: 5000 }] },
      }),
    ]);

    const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1', period });

    expect(widgets.find((w) => w.id === 'invoice:issued-this-month')).toBeUndefined();
    expect(widgets.find((w) => w.id === 'invoice:issued-this-month:EUR')).toBeUndefined();
    const issued = widgets.find((w) => w.id === 'invoice:issued-in-period:EUR');
    expect(issued).toMatchObject({
      kind: 'metric',
      unit: 'EUR',
      value: 300,
      label: 'Invoiced in period (EUR)',
    });
    expect(issued).not.toHaveProperty('previousValue');
  });

  it("the curve spans exactly the period's own calendar months, not the trailing 6-month window", async () => {
    seedDocuments([
      invoice({
        id: 'i1',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-06-10', lines: [{ quantity: 1, unitPrice: 1 }] },
      }),
    ]);

    const period = { dateFrom: '2026-05-01', dateTo: '2026-06-30' };
    const widgets = await buildInvoiceDashboardWidgets({ companyId: 'c1', period });
    const curve = widgets.find((w) => w.kind === 'timeSeries') as TimeSeriesWidget;

    expect(curve.points).toHaveLength(2);
    expect(curve.points[1].value).toBe(1); // June, the invoice's own month
  });
});

describe('monthsSpanning', () => {
  it('a one-month period produces exactly one point', () => {
    expect(monthsSpanning('2026-08-01', '2026-08-31')).toEqual([{ key: '2026-08', label: 'Aug 26' }]);
  });

  it('spans a year boundary inclusive on both ends', () => {
    expect(monthsSpanning('2025-12-01', '2026-01-31').map((m) => m.key)).toEqual(['2025-12', '2026-01']);
  });
});

describe('buildInvoiceStatisticsWidgets', () => {
  beforeEach(() => {
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
  });

  it('renders one detailed row per invoice, and a total count metric', async () => {
    seedDocuments([
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
      // Unlike the dashboard's own "pending" list (see the dedicated
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

import { vi, type Mock } from 'vitest';

import {
  buildQuoteDashboardWidgets,
  buildQuoteStatisticsWidgets,
  quoteGrossTotal,
} from './quote-contributions';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import { DocumentInstanceResult } from '../actions/action-registry';
import { MetricWidget, ShortListWidget, TableWidget } from './widgets';

// `dayMs`/`dateValueInRange` are kept REAL - see invoice-contributions.spec.ts's own identical
// comment for why a blanket `vi.mock('../persistence')` would silently break issue #418's
// period-restriction helper.
vi.mock('../persistence', async () => {
  const actual = await vi.importActual<typeof import('../persistence')>('../persistence');
  return { ...actual, listAllDocuments: vi.fn(), listRecentDocuments: vi.fn(), countDocuments: vi.fn() };
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

function quote(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'q-1',
    typeId: 'quote',
    status: 'draft',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    displayNumber: null,
    ...overrides,
  };
}

describe('quoteGrossTotal', () => {
  it('reuses compute-totals — net + VAT, never a VAT-blind sum', () => {
    const { amount, currency } = quoteGrossTotal({
      currency: 'EUR',
      lines: [{ description: 'A', quantity: 2, unitPrice: 100, vatRate: '20' }],
    });
    // 2 * 100 = 200 net, +20% VAT = 240 gross.
    expect(amount).toBeCloseTo(240);
    expect(currency).toBe('EUR');
  });

  it('a quote with no usable lines totals to 0, not a crash', () => {
    expect(quoteGrossTotal({}).amount).toBe(0);
  });
});

describe('buildQuoteDashboardWidgets', () => {
  beforeEach(() => {
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
  });

  it('shows only DRAFT quotes — a sent one never appears in the shortlist', async () => {
    seedDocuments([
      quote({ id: 'draft-1', status: 'draft', data: { issueDate: '2026-01-01' } }),
      quote({
        id: 'sent-1',
        status: 'sent',
        displayNumber: 'QUO-2026-0001',
        data: { issueDate: '2026-01-02' },
      }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items.map((i) => i.id)).toEqual(['draft-1']);
  });

  it('a never-sent draft shows the FACT (no number yet), never a fabricated number', async () => {
    seedDocuments([
      quote({ id: 'draft-1', status: 'draft', displayNumber: null, data: { issueDate: '2026-01-05' } }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items[0]).toMatchObject({
      id: 'draft-1',
      primary: 'Draft — no number yet',
      secondary: '2026-01-05',
    });
  });

  it('a quote sent, then re-saved as draft, keeps showing its real number — the number is never cleared', async () => {
    seedDocuments([
      quote({
        id: 'reverted-1',
        status: 'draft',
        displayNumber: 'QUO-2026-0007',
        data: { issueDate: '2026-02-01' },
      }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items[0].primary).toBe('QUO-2026-0007');
  });

  it('relies on listDocuments\' own updatedAt-desc order for "most recent first" — no re-sort', async () => {
    // listDocuments (mocked here) is documented to already return most-recently-updated first;
    // this contribution must preserve that order rather than re-sort by something else.
    seedDocuments([
      quote({ id: 'newest', status: 'draft', data: {} }),
      quote({ id: 'oldest', status: 'draft', data: {} }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items.map((i) => i.id)).toEqual(['newest', 'oldest']);
  });

  it('"Open quotes" counts drafts and sent ones — signed, sending and failed sends are not open', async () => {
    seedDocuments([
      quote({ id: 'd1', status: 'draft', data: {} }),
      quote({ id: 's1', status: 'sent', displayNumber: 'QUO-1', data: {} }),
      quote({ id: 'signed', status: 'signed', displayNumber: 'QUO-2', data: {} }),
      quote({ id: 'in-flight', status: 'sending', data: {} }),
      quote({ id: 'failed', status: 'send_failed', data: {} }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(widgets.find((w) => w.id === 'quote:open-count')).toMatchObject({ kind: 'metric', value: 2 });
    // The rows carry the status and the type that lets the dashboard badge and open them.
    expect(shortList.documentTypeId).toBe('quote');
    expect(shortList.items[0]).toMatchObject({ id: 'd1', status: 'draft' });
  });
});

// Issue #418: "quote:open-count"/"quote:draft" restrict themselves by the quote's own resolved date
// field (`issueDate`) once a period is set.
describe('buildQuoteDashboardWidgets with a period set', () => {
  beforeEach(() => {
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
  });

  const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

  it('the draft shortlist and the open count only include quotes issued IN the period', async () => {
    seedDocuments([
      quote({ id: 'in-period', status: 'draft', data: { issueDate: '2026-08-15' } }),
      quote({ id: 'before-period', status: 'draft', data: { issueDate: '2026-07-31' } }),
      quote({
        id: 'sent-in-period',
        status: 'sent',
        displayNumber: 'QUO-1',
        data: { issueDate: '2026-08-20' },
      }),
      quote({
        id: 'sent-after-period',
        status: 'sent',
        displayNumber: 'QUO-2',
        data: { issueDate: '2026-09-01' },
      }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1', period });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items.map((i) => i.id)).toEqual(['in-period']);
    expect(widgets.find((w) => w.id === 'quote:open-count')).toMatchObject({ value: 2 });
  });

  it('boundary dates are inclusive', async () => {
    seedDocuments([
      quote({ id: 'first-day', status: 'draft', data: { issueDate: '2026-08-01' } }),
      quote({ id: 'last-day', status: 'draft', data: { issueDate: '2026-08-31' } }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1', period });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items.map((i) => i.id).sort()).toEqual(['first-day', 'last-day']);
  });

  it('the "open quotes" link carries the period', async () => {
    seedDocuments([quote({ id: 'd1', status: 'draft', data: { issueDate: '2026-08-15' } })]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1', period });
    const openMetric = widgets.find((w) => w.id === 'quote:open-count');

    expect((openMetric as MetricWidget).link).toMatchObject({
      typeId: 'quote',
      status: ['draft', 'sent'],
      ...period,
    });
  });
});

describe('buildQuoteStatisticsWidgets', () => {
  beforeEach(() => {
    listAllDocuments.mockReset();
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
  });

  it('"Quotes sent" counts only quotes CURRENTLY at status "sent"', async () => {
    seedDocuments([
      quote({ id: 'd1', status: 'draft', data: {} }),
      quote({ id: 's1', status: 'sent', displayNumber: 'QUO-1', data: {} }),
      quote({ id: 's2', status: 'sent', displayNumber: 'QUO-2', data: {} }),
    ]);

    const widgets = await buildQuoteStatisticsWidgets({ companyId: 'c1' });
    const metric = widgets.find((w) => w.kind === 'metric') as MetricWidget;

    expect(metric).toMatchObject({ label: 'Quotes sent', value: 2 });
  });

  it('renders one detailed row per quote, including the reused gross total', async () => {
    seedDocuments([
      quote({
        id: 'q1',
        status: 'sent',
        data: {
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          currency: 'EUR',
          lines: [{ description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' }],
        },
      }),
    ]);

    const widgets = await buildQuoteStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([
      { issueDate: '2026-01-01', dueDate: '2026-01-31', status: 'sent', currency: 'EUR', total: 120 },
    ]);
  });
});

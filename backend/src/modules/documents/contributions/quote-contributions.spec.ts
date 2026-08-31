import {
  buildQuoteDashboardWidgets,
  buildQuoteStatisticsWidgets,
  quoteGrossTotal,
} from './quote-contributions';
import * as persistence from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';
import { MetricWidget, ShortListWidget, TableWidget } from './widgets';

jest.mock('../persistence');

const listDocuments = persistence.listDocuments as jest.Mock;

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
  beforeEach(() => listDocuments.mockReset());

  it('shows only DRAFT quotes — a sent one never appears in the shortlist', async () => {
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
      quote({ id: 'newest', status: 'draft', data: {} }),
      quote({ id: 'oldest', status: 'draft', data: {} }),
    ]);

    const widgets = await buildQuoteDashboardWidgets({ companyId: 'c1' });
    const shortList = widgets.find((w) => w.kind === 'shortList') as ShortListWidget;

    expect(shortList.items.map((i) => i.id)).toEqual(['newest', 'oldest']);
  });
});

describe('buildQuoteStatisticsWidgets', () => {
  beforeEach(() => listDocuments.mockReset());

  it('"Quotes sent" counts only quotes CURRENTLY at status "sent"', async () => {
    listDocuments.mockResolvedValue([
      quote({ id: 'd1', status: 'draft', data: {} }),
      quote({ id: 's1', status: 'sent', displayNumber: 'QUO-1', data: {} }),
      quote({ id: 's2', status: 'sent', displayNumber: 'QUO-2', data: {} }),
    ]);

    const widgets = await buildQuoteStatisticsWidgets({ companyId: 'c1' });
    const metric = widgets.find((w) => w.kind === 'metric') as MetricWidget;

    expect(metric).toMatchObject({ label: 'Quotes sent', value: 2 });
  });

  it('renders one detailed row per quote, including the reused gross total', async () => {
    listDocuments.mockResolvedValue([
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

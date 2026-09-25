import { vi, type Mock } from 'vitest';

import { buildReceivedInvoiceDashboardWidgets, grossAmount } from './received-invoice-contributions';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import { DocumentInstanceResult } from '../actions/action-registry';
import { MetricWidget } from './widgets';

// `dayMs`/`dateValueInRange` are kept REAL - see invoice-contributions.spec.ts's own identical
// comment for why a blanket `vi.mock('../persistence')` would silently break issue #418's
// period-restriction helper.
vi.mock('../persistence', async () => {
  const actual = await vi.importActual<typeof import('../persistence')>('../persistence');
  return { ...actual, listAllDocuments: vi.fn() };
});

const listAllDocuments = persistence.listAllDocuments as Mock;

/** Hands the code under test only the rows the QUERY would have returned. The client/status/type
 *  narrowing moved into SQL when the read stopped being capped, so a mock returning a fixture
 *  verbatim would feed it rows production never sees. Fixtures here stay small on purpose — they
 *  prove the rules around the read; the cap-crossing fixtures live in `*.read-cap.spec.ts`. */
function seedDocuments(rows: DocumentInstanceResult[]): void {
  listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
    filterLikeListAllDocuments(rows, options),
  );
}

function receivedInvoice(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'ri-1',
    typeId: 'received-invoice',
    status: 'received',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('grossAmount', () => {
  it('reads data.grossAmount directly', () => {
    expect(grossAmount({ grossAmount: 120 })).toBe(120);
  });

  it('treats a missing/non-numeric amount as 0 rather than throwing', () => {
    expect(grossAmount({})).toBe(0);
    expect(grossAmount({ grossAmount: 'not-a-number' })).toBe(0);
  });
});

describe('buildReceivedInvoiceDashboardWidgets', () => {
  beforeEach(() => listAllDocuments.mockReset());

  it('counts every "received" (pending review) instance, grouped amounts by currency', async () => {
    seedDocuments([
      receivedInvoice({ id: 'ri-1', status: 'received', data: { grossAmount: 120, currency: 'EUR' } }),
      receivedInvoice({ id: 'ri-2', status: 'received', data: { grossAmount: 30, currency: 'EUR' } }),
      // A different currency, same status — its own metric, never merged into EUR's.
      receivedInvoice({ id: 'ri-3', status: 'received', data: { grossAmount: 50, currency: 'USD' } }),
      // Already reviewed — excluded from BOTH the count and the amounts entirely.
      receivedInvoice({ id: 'ri-4', status: 'approved', data: { grossAmount: 9999, currency: 'EUR' } }),
      receivedInvoice({ id: 'ri-5', status: 'rejected', data: { grossAmount: 9999, currency: 'EUR' } }),
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({ companyId: 'c1' })) as MetricWidget[];

    const count = widgets.find((w) => w.id === 'received-invoice:pending-count');
    const eur = widgets.find((w) => w.id === 'received-invoice:pending-amount:EUR');
    const usd = widgets.find((w) => w.id === 'received-invoice:pending-amount:USD');

    expect(count).toMatchObject({ label: 'Received invoices pending review', value: 3 });
    expect(count?.unit).toBeUndefined();
    expect(eur).toMatchObject({ unit: 'EUR', value: 150 });
    expect(usd).toMatchObject({ unit: 'USD', value: 50 });
  });

  it('a pending record with no recorded amount still counts, but contributes nothing to the currency totals', async () => {
    seedDocuments([
      receivedInvoice({ id: 'ri-1', status: 'received', data: {} }), // a plain scanned PDF, nothing extracted
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({ companyId: 'c1' })) as MetricWidget[];

    expect(widgets).toEqual([
      {
        id: 'received-invoice:pending-count',
        kind: 'metric',
        label: 'Received invoices pending review',
        value: 1,
        link: { typeId: 'received-invoice', status: ['received'] },
      },
    ]);
  });

  it('nothing pending at all: a zero count, no currency metrics', async () => {
    seedDocuments([]);

    const widgets = await buildReceivedInvoiceDashboardWidgets({ companyId: 'c1' });

    expect(widgets).toEqual([
      {
        id: 'received-invoice:pending-count',
        kind: 'metric',
        label: 'Received invoices pending review',
        value: 0,
        link: { typeId: 'received-invoice', status: ['received'] },
      },
    ]);
  });
});

// Issue #418: restricted by the type's own resolved date field (`issueDate`) once a period is set.
describe('buildReceivedInvoiceDashboardWidgets with a period set', () => {
  beforeEach(() => listAllDocuments.mockReset());

  const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

  it('only counts/sums records whose issueDate is IN the period', async () => {
    seedDocuments([
      receivedInvoice({
        id: 'in-period',
        status: 'received',
        data: { grossAmount: 100, currency: 'EUR', issueDate: '2026-08-15' },
      }),
      receivedInvoice({
        id: 'before-period',
        status: 'received',
        data: { grossAmount: 9999, currency: 'EUR', issueDate: '2026-07-31' },
      }),
      receivedInvoice({
        id: 'after-period',
        status: 'received',
        data: { grossAmount: 9999, currency: 'EUR', issueDate: '2026-09-01' },
      }),
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({
      companyId: 'c1',
      period,
    })) as MetricWidget[];

    expect(widgets.find((w) => w.id === 'received-invoice:pending-count')).toMatchObject({ value: 1 });
    expect(widgets.find((w) => w.id === 'received-invoice:pending-amount:EUR')).toMatchObject({ value: 100 });
  });

  it('a record with no issueDate at all is excluded once a period is set - never guessed into range', async () => {
    seedDocuments([
      receivedInvoice({ id: 'no-date', status: 'received', data: { grossAmount: 50, currency: 'EUR' } }),
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({
      companyId: 'c1',
      period,
    })) as MetricWidget[];

    expect(widgets.find((w) => w.id === 'received-invoice:pending-count')).toMatchObject({ value: 0 });
  });

  it('the link carries the period', async () => {
    seedDocuments([
      receivedInvoice({
        id: 'a',
        status: 'received',
        data: { grossAmount: 10, currency: 'EUR', issueDate: '2026-08-15' },
      }),
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({
      companyId: 'c1',
      period,
    })) as MetricWidget[];
    const count = widgets.find((w) => w.id === 'received-invoice:pending-count');

    expect((count as MetricWidget).link).toMatchObject({
      typeId: 'received-invoice',
      status: ['received'],
      ...period,
    });
  });
});

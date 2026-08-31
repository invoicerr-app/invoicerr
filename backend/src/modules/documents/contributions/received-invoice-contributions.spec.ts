import { buildReceivedInvoiceDashboardWidgets, grossAmount } from './received-invoice-contributions';
import * as persistence from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';
import { MetricWidget } from './widgets';

jest.mock('../persistence');

const listDocuments = persistence.listDocuments as jest.Mock;

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
  beforeEach(() => listDocuments.mockReset());

  it('counts every "received" (pending review) instance, grouped amounts by currency', async () => {
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
      receivedInvoice({ id: 'ri-1', status: 'received', data: {} }), // a plain scanned PDF, nothing extracted
    ]);

    const widgets = (await buildReceivedInvoiceDashboardWidgets({ companyId: 'c1' })) as MetricWidget[];

    expect(widgets).toEqual([
      {
        id: 'received-invoice:pending-count',
        kind: 'metric',
        label: 'Received invoices pending review',
        value: 1,
      },
    ]);
  });

  it('nothing pending at all: a zero count, no currency metrics', async () => {
    listDocuments.mockResolvedValue([]);

    const widgets = await buildReceivedInvoiceDashboardWidgets({ companyId: 'c1' });

    expect(widgets).toEqual([
      {
        id: 'received-invoice:pending-count',
        kind: 'metric',
        label: 'Received invoices pending review',
        value: 0,
      },
    ]);
  });
});

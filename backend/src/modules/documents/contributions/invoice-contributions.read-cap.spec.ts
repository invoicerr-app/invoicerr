/**
 * The dashboard's and statistics screen's invoice figures, over a company whose invoice history
 * crosses the read cap — and the one place in this module where the TWO fixes differ.
 *
 *  - The dashboard's totals are aggregates: they must cover every invoice. Read exhaustively.
 *  - The statistics TABLE is a display list of individual invoices, where showing the most recent N
 *    is a real answer — so it stays capped, says so in its own `warnings`, and the "Total invoices"
 *    metric beside it is counted in SQL rather than read off the page. A metric derived from the page
 *    would stop growing at the cap while the screen went on calling it the total.
 *
 * `invoice-contributions.spec.ts` next door mocks `../persistence` wholesale and so can never see
 * either problem; this file runs the real reads against the in-memory table, with 600 invoices.
 */
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import { MetricWidget, TableWidget } from './widgets';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});
vi.mock('../settlement/payments', () => ({
  sumPaidMinorByDocument: vi.fn().mockResolvedValue(new Map()),
  // Issue #417's "Collections" tile reads this too - defaulted to "no payments at all" so this
  // file's own read-cap fixtures (which never record a payment) keep meaning exactly what they did
  // before that tile existed.
  listPaymentsInRange: vi.fn().mockResolvedValue([]),
}));

const { buildInvoiceDashboardWidgets, buildInvoiceStatisticsWidgets } = await import(
  './invoice-contributions'
);

/** Past the 500-row cap these reads used to apply, and past the 500-row display cap the statistics
 *  table still applies — so the same fixture exercises both fixes. */
const INVOICE_COUNT = 600;
/** `invoiceTotal` sums `quantity * unitPrice` per line: 100.00 per invoice. */
const TOTAL_PER_INVOICE = 100;

function invoiceData() {
  return {
    client: 'client-1',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' }],
  };
}

const context = { companyId: 'company-1' } as Parameters<typeof buildInvoiceDashboardWidgets>[0];

beforeEach(() => {
  seedDocumentInstances(
    Array.from({ length: INVOICE_COUNT }, (_, index) =>
      documentInstanceRow({
        id: `inv-${String(index).padStart(5, '0')}`,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: `INV-${index}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: invoiceData(),
      }),
    ),
  );
});

describe('the dashboard aggregates every invoice', () => {
  it('totals the pending invoices over the whole company, not over one page', async () => {
    const widgets = await buildInvoiceDashboardWidgets(context);

    const pendingTotal = widgets.find(
      (widget): widget is MetricWidget => widget.id === 'invoice:pending-total:EUR',
    );
    expect(pendingTotal?.value).toBe(INVOICE_COUNT * TOTAL_PER_INVOICE);
  });

  it('totals the overdue invoices over the whole company too', async () => {
    // Every fixture invoice was due 2026-02-01, long past by any clock this suite runs under.
    const widgets = await buildInvoiceDashboardWidgets(context);

    const overdueTotal = widgets.find(
      (widget): widget is MetricWidget => widget.id === 'invoice:overdue-total:EUR',
    );
    expect(overdueTotal?.value).toBe(INVOICE_COUNT * TOTAL_PER_INVOICE);
  });
});

describe('the statistics screen is a capped list beside an uncapped count', () => {
  it('counts every invoice, however many rows the table shows', async () => {
    const widgets = await buildInvoiceStatisticsWidgets(context);

    const countMetric = widgets.find((widget): widget is MetricWidget => widget.id === 'invoice:count');
    expect(countMetric?.value).toBe(INVOICE_COUNT);
  });

  it('says on the widget itself that the table is showing a subset', async () => {
    const widgets = await buildInvoiceStatisticsWidgets(context);

    const table = widgets.find((widget): widget is TableWidget => widget.id === 'invoice:all');
    expect(table?.rows.length).toBeLessThan(INVOICE_COUNT);
    expect(table?.warnings?.join(' ')).toContain(`of ${INVOICE_COUNT}`);
  });

  it('carries no such caveat when the whole history fits', async () => {
    seedDocumentInstances([documentInstanceRow({ id: 'inv-only', status: 'sent', data: invoiceData() })]);

    const widgets = await buildInvoiceStatisticsWidgets(context);

    const table = widgets.find((widget): widget is TableWidget => widget.id === 'invoice:all');
    expect(table?.rows).toHaveLength(1);
    expect(table?.warnings).toBeUndefined();
  });
});

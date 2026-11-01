import { describe, expect, it } from 'vitest';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceOverview, OverviewBalance, OverviewPayment } from './invoice-overview';

function invoice(
  id: string,
  data: Record<string, unknown>,
  status = 'sent',
  displayNumber: string | null = `INV-${id}`,
): DocumentInstanceResult {
  return {
    id,
    typeId: 'invoice',
    status,
    data,
    displayNumber,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as DocumentInstanceResult;
}

function line(unitPrice: number) {
  return { lines: [{ description: 'Work', quantity: 1, unit: 'day', unitPrice, vatRate: '20' }] };
}

const TODAY = '2026-10-28';

function balance(inv: DocumentInstanceResult, outstandingMinor: number): OverviewBalance {
  return { invoice: inv, outstandingMinor };
}

describe('buildInvoiceOverview', () => {
  it('totals what was invoiced this month and last month, net, in the company currency only', () => {
    const invoices = [
      invoice('a', { ...line(1000), currency: 'EUR', issueDate: '2026-10-05', client: 'c1' }),
      invoice('b', { ...line(500), currency: 'EUR', issueDate: '2026-10-20', client: 'c1' }, 'imported'),
      invoice('c', { ...line(800), currency: 'EUR', issueDate: '2026-09-12', client: 'c2' }),
      invoice('d', { ...line(9999), currency: 'USD', issueDate: '2026-10-07', client: 'c2' }),
      invoice('e', { ...line(7777), currency: 'EUR', issueDate: '2026-10-08', client: 'c2' }, 'draft'),
    ];
    const overview = buildInvoiceOverview({
      currency: 'EUR',
      today: TODAY,
      invoices,
      unsettled: [],
      payments: [],
      clientLabels: new Map(),
    });
    expect(overview.month).toBe('2026-10');
    expect(overview.invoicedThisMonth).toBe(1500);
    expect(overview.invoicedLastMonth).toBe(800);
  });

  it('draws twelve months of the year: collected up to this month, expected from due dates after it', () => {
    const late = invoice('a', {
      ...line(100),
      currency: 'EUR',
      issueDate: '2026-11-02',
      dueDate: '2026-11-30',
    });
    const later = invoice('b', {
      ...line(100),
      currency: 'EUR',
      issueDate: '2026-10-02',
      dueDate: '2026-12-15',
    });
    const payments: OverviewPayment[] = [
      { documentId: 'x', amountMinor: 120000, currency: 'EUR', paidAt: new Date('2026-10-03T10:00:00Z') },
      { documentId: 'y', amountMinor: 30000, currency: 'EUR', paidAt: new Date('2026-03-20T10:00:00Z') },
      { documentId: 'z', amountMinor: 99900, currency: 'USD', paidAt: new Date('2026-10-04T10:00:00Z') },
    ];
    const overview = buildInvoiceOverview({
      currency: 'EUR',
      today: TODAY,
      invoices: [late, later],
      unsettled: [balance(late, 12000), balance(later, 24000)],
      payments,
      clientLabels: new Map(),
    });
    expect(overview.months).toHaveLength(12);
    expect(overview.months[0]).toEqual({ month: '2026-01', collected: 0, expected: null });
    expect(overview.months[2]).toEqual({ month: '2026-03', collected: 300, expected: null });
    // The dashed line starts on this month's own point, so the two read as one curve.
    expect(overview.months[9]).toEqual({ month: '2026-10', collected: 1200, expected: 1200 });
    expect(overview.months[10]).toEqual({ month: '2026-11', collected: null, expected: 120 });
    expect(overview.months[11]).toEqual({ month: '2026-12', collected: null, expected: 240 });
  });

  it('lists the clients to chase, one row per client and currency, the largest amount first', () => {
    const a1 = invoice('a1', { currency: 'EUR', dueDate: '2026-10-16', client: 'c1' });
    const a2 = invoice('a2', { currency: 'EUR', dueDate: '2026-09-17', client: 'c1' });
    const b = invoice('b', { currency: 'EUR', dueDate: '2026-10-26', client: 'c2' });
    const notYet = invoice('n', { currency: 'EUR', dueDate: '2026-10-28', client: 'c3' });
    const overview = buildInvoiceOverview({
      currency: 'EUR',
      today: TODAY,
      invoices: [a1, a2, b, notYet],
      unsettled: [balance(a1, 10000), balance(a2, 5000), balance(b, 90000), balance(notYet, 1000)],
      payments: [],
      clientLabels: new Map([
        ['c1', 'Studio Pixel'],
        ['c2', 'Maison Bellerive'],
      ]),
    });
    expect(overview.toChase).toEqual([
      {
        clientId: 'c2',
        client: 'Maison Bellerive',
        invoiceCount: 1,
        daysLate: 2,
        outstanding: 900,
        currency: 'EUR',
      },
      {
        clientId: 'c1',
        client: 'Studio Pixel',
        invoiceCount: 2,
        daysLate: 41,
        outstanding: 150,
        currency: 'EUR',
      },
    ]);
  });

  it('lists what falls due this week, today included, soonest first', () => {
    const today = invoice('t', { currency: 'EUR', dueDate: '2026-10-28', client: 'c1' });
    const sunday = invoice('s', { currency: 'EUR', dueDate: '2026-11-03', client: 'c2' });
    const tooFar = invoice('f', { currency: 'EUR', dueDate: '2026-11-05', client: 'c2' });
    const overview = buildInvoiceOverview({
      currency: 'EUR',
      today: TODAY,
      invoices: [sunday, today, tooFar],
      unsettled: [balance(sunday, 2000), balance(today, 1000), balance(tooFar, 3000)],
      payments: [],
      clientLabels: new Map([['c1', 'Boulangerie']]),
    });
    expect(overview.thisWeek).toEqual([
      {
        documentId: 't',
        displayNumber: 'INV-t',
        client: 'Boulangerie',
        dueDate: '2026-10-28',
        outstanding: 10,
        currency: 'EUR',
      },
      {
        documentId: 's',
        displayNumber: 'INV-s',
        client: null,
        dueDate: '2026-11-03',
        outstanding: 20,
        currency: 'EUR',
      },
    ]);
  });
});

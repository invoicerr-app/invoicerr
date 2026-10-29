/**
 * The dashboard's invoicing overview: what was invoiced this month, money collected month by month
 * with what the due dates promise for the rest of the year, the clients to chase and what falls due
 * this week. A pure builder over data the caller has already read (`documents.service.ts`), so every
 * rule below is testable without a database.
 *
 * One currency at a time for anything summed (the company's own): amounts in different currencies
 * are never added up. The two lists carry each invoice's own currency instead.
 */
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();
const WEEK_DAYS = 7;

export interface OverviewBalance {
  invoice: DocumentInstanceResult;
  outstandingMinor: number;
}

export interface OverviewPayment {
  documentId: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
}

export interface OverviewMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Collected that month; null after the current month. */
  collected: number | null;
  /** Still owed on invoices due that month; null before the current month. */
  expected: number | null;
}

export interface OverviewChaseRow {
  clientId: string | null;
  client: string | null;
  invoiceCount: number;
  daysLate: number;
  outstanding: number;
  currency: string;
}

export interface OverviewDueRow {
  documentId: string;
  displayNumber: string | null;
  client: string | null;
  dueDate: string;
  outstanding: number;
  currency: string;
}

export interface InvoiceOverview {
  currency: string;
  /** `YYYY-MM` of today. */
  month: string;
  /** Net, issued (sent or imported) invoices in `currency`. */
  invoicedThisMonth: number;
  invoicedLastMonth: number;
  months: OverviewMonth[];
  toChase: OverviewChaseRow[];
  thisWeek: OverviewDueRow[];
}

export interface InvoiceOverviewInput {
  currency: string;
  /** `YYYY-MM-DD`, the same UTC calendar day every other dashboard figure is keyed on. */
  today: string;
  invoices: readonly DocumentInstanceResult[];
  unsettled: readonly OverviewBalance[];
  payments: readonly OverviewPayment[];
  clientLabels: ReadonlyMap<string, string>;
}

function dataOf(invoice: DocumentInstanceResult): Record<string, unknown> {
  return (invoice.data ?? {}) as Record<string, unknown>;
}

function dateOnly(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function amount(minor: number, currency: string): number {
  return Number(fromMinor(minor, currency).toFixed(2));
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function buildInvoiceOverview(input: InvoiceOverviewInput): InvoiceOverview {
  const { currency, today, clientLabels } = input;
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1;
  const lastMonth = new Date(Date.UTC(year, monthIndex - 1, 1)).toISOString().slice(0, 7);

  let invoicedThisMonthMinor = 0;
  let invoicedLastMonthMinor = 0;
  for (const invoice of input.invoices) {
    if (invoice.status !== 'sent' && invoice.status !== 'imported') continue;
    const data = dataOf(invoice);
    if (data.currency !== currency) continue;
    const issued = dateOnly(data.issueDate).slice(0, 7);
    if (issued !== month && issued !== lastMonth) continue;
    const net = computeDocumentTotals(INVOICE_DESCRIPTOR, data).netMinor;
    if (issued === month) invoicedThisMonthMinor += net;
    else invoicedLastMonthMinor += net;
  }

  const collectedByMonth = new Map<string, number>();
  for (const payment of input.payments) {
    if (payment.currency !== currency) continue;
    const key = payment.paidAt.toISOString().slice(0, 7);
    collectedByMonth.set(key, (collectedByMonth.get(key) ?? 0) + payment.amountMinor);
  }
  const expectedByMonth = new Map<string, number>();
  for (const { invoice, outstandingMinor } of input.unsettled) {
    const data = dataOf(invoice);
    if (data.currency !== currency) continue;
    const key = dateOnly(data.dueDate).slice(0, 7);
    if (!key) continue;
    expectedByMonth.set(key, (expectedByMonth.get(key) ?? 0) + outstandingMinor);
  }
  const months: OverviewMonth[] = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    const collected = amount(collectedByMonth.get(key) ?? 0, currency);
    if (index < monthIndex) return { month: key, collected, expected: null };
    if (index === monthIndex) return { month: key, collected, expected: collected };
    return { month: key, collected: null, expected: amount(expectedByMonth.get(key) ?? 0, currency) };
  });

  const chase = new Map<string, OverviewChaseRow & { outstandingMinor: number }>();
  const thisWeek: (OverviewDueRow & { outstandingMinor: number })[] = [];
  const weekEnd = addDays(today, WEEK_DAYS - 1);
  for (const { invoice, outstandingMinor } of input.unsettled) {
    if (outstandingMinor <= 0) continue;
    const data = dataOf(invoice);
    const dueDate = dateOnly(data.dueDate);
    if (!dueDate) continue;
    const rowCurrency = typeof data.currency === 'string' ? data.currency : '';
    const clientId = typeof data.client === 'string' ? data.client : null;
    const client = clientId ? (clientLabels.get(clientId) ?? null) : null;
    if (dueDate < today) {
      const key = `${clientId ?? invoice.id}|${rowCurrency}`;
      const row = chase.get(key) ?? {
        clientId,
        client,
        invoiceCount: 0,
        daysLate: 0,
        outstanding: 0,
        currency: rowCurrency,
        outstandingMinor: 0,
      };
      row.invoiceCount += 1;
      row.daysLate = Math.max(row.daysLate, daysBetween(dueDate, today));
      row.outstandingMinor += outstandingMinor;
      chase.set(key, row);
    } else if (dueDate <= weekEnd) {
      thisWeek.push({
        documentId: invoice.id,
        displayNumber: invoice.displayNumber ?? null,
        client,
        dueDate,
        outstanding: 0,
        currency: rowCurrency,
        outstandingMinor,
      });
    }
  }

  return {
    currency,
    month,
    invoicedThisMonth: amount(invoicedThisMonthMinor, currency),
    invoicedLastMonth: amount(invoicedLastMonthMinor, currency),
    months,
    toChase: [...chase.values()]
      .sort((a, b) => b.outstandingMinor - a.outstandingMinor)
      .map(({ outstandingMinor, ...row }) => ({
        ...row,
        outstanding: amount(outstandingMinor, row.currency),
      })),
    thisWeek: thisWeek
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map(({ outstandingMinor, ...row }) => ({
        ...row,
        outstanding: amount(outstandingMinor, row.currency),
      })),
  };
}

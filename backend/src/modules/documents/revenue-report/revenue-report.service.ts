import { BadRequestException } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

import {
  resolveRevenueSettings,
  RevenueBasis,
  RevenuePeriod,
} from '@/modules/company/revenue-basis/resolve-revenue-basis';

import { loadCurrencyContext } from '../contributions/currency-consolidation';
import { listAllDocuments } from '../persistence';
import { listPaymentsInRange } from '../settlement/payments';
import { decimalsFor, fromMinor } from '@/utils/financial';
import { toCsvLine } from '@/utils/csv';
import { buildCashedRevenuePeriods, CashedPaymentLike, CashedRevenuePeriod } from './cashed-revenue';

/**
 * Issue #516's "a cashed-revenue view per period" — the DB-touching half; `cashed-revenue.ts` carries
 * every arithmetic/bucketing rule, pure and directly testable. This file only decides WHICH payments
 * count (mirrors `invoice-contributions.ts`'s own `issuedInvoiceIds` filter verbatim: a payment
 * counts as revenue only when it settles a "sent" invoice — never a `received-invoice`'s own payment,
 * money going OUT, and never a payment left sitting against an invoice that has SINCE been
 * cancelled), resolves the company's own settings (revenue basis/period, reference currency, stored
 * rates), and renders the result either as JSON or as the CSV `revenue-report.controller.ts` streams
 * back.
 *
 * Explicitly labelled, everywhere this surfaces (the JSON payload's own `disclaimer`, and the CSV's
 * own leading comment line): an AID for a company preparing its own declaration, never the
 * declaration itself — see this issue's own text and `resolve-revenue-basis.ts`'s header for why no
 * single number this product could compute is authoritative across five different countries' rules.
 */

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CASHED_REVENUE_DISCLAIMER =
  'This is an aid to help prepare a revenue declaration, not the official declaration itself. ' +
  'Verify every figure against your own accounting records and your local tax authority’s rules ' +
  'before filing.';

function parseDateParam(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!DATE_PARAM_PATTERN.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`"${name}" must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function parseGranularity(value: string | undefined, fallback: RevenuePeriod): RevenuePeriod {
  if (value === undefined) return fallback;
  if (value === 'monthly' || value === 'quarterly') return value;
  throw new BadRequestException('"granularity" must be "monthly" or "quarterly".');
}

/** `YYYY-MM-DD` of the first day of the current UTC month — the default window's own end anchor. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** No `from`/`to` given -> the trailing window a reader most often wants: the last 12 months, or the
 *  last 8 quarters, ending with the period `today` falls in — always INCLUDING the current,
 *  still-open period (a company mid-quarter still wants to see what it has cashed so far). */
function defaultRange(granularity: RevenuePeriod): { from: string; to: string } {
  const now = new Date();
  const to = todayIso();
  const monthsBack = granularity === 'monthly' ? 11 : 22; // 12 months / 8 quarters, 0-indexed span
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

export interface CashedRevenueQuery {
  granularity?: string;
  from?: string;
  to?: string;
}

export interface CashedRevenueReport {
  basis: RevenueBasis;
  granularity: RevenuePeriod;
  granularityIsExplicit: boolean;
  disclaimer: string;
  periods: CashedRevenuePeriod[];
}

interface CompanyRevenueContext {
  countryCode: string | null;
  revenueBasis: string | null;
  revenuePeriod: string | null;
}

async function loadCompanyRevenueContext(companyId: string): Promise<CompanyRevenueContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { countryCode: true, revenueBasis: true, revenuePeriod: true },
  });
  return {
    countryCode: company?.countryCode ?? null,
    revenueBasis: company?.revenueBasis ?? null,
    revenuePeriod: company?.revenuePeriod ?? null,
  };
}

/**
 * Every payment that counts as CASHED REVENUE for `companyId` — a "sent" invoice's own payment,
 * excluding a cancelled invoice's, in the payment's OWN currency/amount (what actually arrived, same
 * figure `invoice-contributions.ts`'s "Collected" tiles already sum — never `documentAmountMinor`,
 * which is a DIFFERENT, document-currency-converted figure meant for settlement math, not for "what
 * did this company actually receive").
 */
async function loadCashedPayments(companyId: string, from: string, to: string): Promise<CashedPaymentLike[]> {
  const sentInvoices = await listAllDocuments(companyId, { typeId: 'invoice', status: ['sent'] });
  const sentInvoiceIds = new Set(sentInvoices.map((invoice) => invoice.id));

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  const payments = await listPaymentsInRange(companyId, fromDate, toDate);

  return payments
    .filter((payment) => sentInvoiceIds.has(payment.documentId))
    .map((payment) => ({
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      paidAt: payment.paidAt,
    }));
}

export async function buildCashedRevenueReport(
  companyId: string,
  query: CashedRevenueQuery,
): Promise<CashedRevenueReport> {
  const context = await loadCompanyRevenueContext(companyId);
  const settings = resolveRevenueSettings(context);

  const granularity = parseGranularity(query.granularity, settings.period);
  const granularityIsExplicit = query.granularity !== undefined || settings.periodIsExplicit;

  const fromParam = parseDateParam('from', query.from);
  const toParam = parseDateParam('to', query.to);
  if ((fromParam === undefined) !== (toParam === undefined)) {
    throw new BadRequestException('"from" and "to" must be given together.');
  }
  const { from, to } = fromParam && toParam ? { from: fromParam, to: toParam } : defaultRange(granularity);
  if (from > to) {
    throw new BadRequestException('"from" must not be after "to".');
  }

  const payments = await loadCashedPayments(companyId, from, to);
  const { referenceCurrency, rates } = await loadCurrencyContext(companyId);
  const periods = buildCashedRevenuePeriods(payments, from, to, granularity, referenceCurrency, rates);

  return {
    basis: settings.basis,
    granularity,
    granularityIsExplicit,
    disclaimer: CASHED_REVENUE_DISCLAIMER,
    periods,
  };
}

const CSV_COLUMNS = [
  'period',
  'dateFrom',
  'dateTo',
  'currency',
  'amount',
  'consolidated',
  'warnings',
] as const;

/**
 * The same report, as a downloadable CSV — one row per (period, currency) actually cashed, plus one
 * "consolidated" row per period when the reference-currency total could be built. A period with
 * nothing cashed still gets ONE row (currency/amount blank) so the file itself carries the "declared,
 * zero" fact rather than a gap a reader could mistake for "not yet exported". Reuses `toCsvLine`
 * verbatim — the exact same RFC 4180 + spreadsheet-formula-guard escaping
 * `accounting-export/build-accounting-csv.ts` already relies on, never a second copy.
 */
export function buildCashedRevenueCsv(report: CashedRevenueReport): string {
  const lines = [toCsvLine(CSV_COLUMNS)];
  // A disclaimer line, commented like a real accounting export's own header would be (`#`, ignored
  // by every spreadsheet importer's default CSV parser) — this file is a standalone artefact once
  // downloaded, so the "aid, not the declaration" label has to travel WITH it, not just live on the
  // screen that offered the download.
  lines.push(`# ${report.disclaimer}`);
  lines.push(`# Revenue basis: ${report.basis}. Granularity: ${report.granularity}.`);

  for (const period of report.periods) {
    if (period.byCurrency.length === 0) {
      lines.push(
        toCsvLine([period.label, period.dateFrom, period.dateTo, '', '', '', period.warnings.join(' ')]),
      );
      continue;
    }
    for (const amount of period.byCurrency) {
      lines.push(
        toCsvLine([
          period.label,
          period.dateFrom,
          period.dateTo,
          amount.currency,
          fromMinor(amount.totalMinor, amount.currency).toFixed(decimalsFor(amount.currency)),
          '',
          '',
        ]),
      );
    }
    if (period.consolidated) {
      const { currency, totalMinor, notes } = period.consolidated;
      lines.push(
        toCsvLine([
          period.label,
          period.dateFrom,
          period.dateTo,
          currency,
          fromMinor(totalMinor, currency).toFixed(decimalsFor(currency)),
          'yes',
          notes.join(' '),
        ]),
      );
    } else if (period.warnings.length > 0) {
      lines.push(
        toCsvLine([period.label, period.dateFrom, period.dateTo, '', '', '', period.warnings.join(' ')]),
      );
    }
  }

  return lines.join('\n');
}

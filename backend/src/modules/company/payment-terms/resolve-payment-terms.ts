import { BadRequestException } from '@nestjs/common';

import { fallbackPaymentTermFor, paymentTermsCapFor } from '@/modules/documents/payment-terms/registry';

export type DueDateMode = 'net' | 'endOfMonth';

export interface DueDateTerm {
  days: number;
  mode: DueDateMode;
}

export interface PaymentTermCap {
  maxNetDays: number;
  maxEndOfMonthDays: number;
}

export interface ResolvedPaymentTerms {
  quote: DueDateTerm | null;
  invoice: DueDateTerm | null;
  /** `null` for a country with no known cap. */
  cap: PaymentTermCap | null;
  /** The country's fallback term for an invoice when the company set none, from the country's own file. */
  countryInvoiceFallback: DueDateTerm | null;
  /** Per document type: the configured term is longer than the country's cap. Never blocks a save. */
  exceedsCap: { quote: boolean; invoice: boolean };
}

const MAX_DUE_DAYS = 365;

function parseMode(value: string | null | undefined): DueDateMode {
  return value === 'endOfMonth' ? 'endOfMonth' : 'net';
}

/** A stored day count that is not a whole number in range means "no default". */
function resolveTerm(days: number | null | undefined, mode: string | null | undefined): DueDateTerm | null {
  if (days === null || days === undefined || !Number.isInteger(days) || days < 0 || days > MAX_DUE_DAYS) {
    return null;
  }
  return { days, mode: parseMode(mode) };
}

function exceeds(term: DueDateTerm | null, cap: PaymentTermCap | null): boolean {
  if (!term || !cap) return false;
  return term.days > (term.mode === 'endOfMonth' ? cap.maxEndOfMonthDays : cap.maxNetDays);
}

/** The one reader of the company's due-date defaults: pure, `company` is already-fetched data. */
export function resolvePaymentTerms(company: {
  quoteDueDays?: number | null;
  quoteDueMode?: string | null;
  invoiceDueDays?: number | null;
  invoiceDueMode?: string | null;
  countryCode?: string | null;
}): ResolvedPaymentTerms {
  const quote = resolveTerm(company.quoteDueDays, company.quoteDueMode);
  const invoice = resolveTerm(company.invoiceDueDays, company.invoiceDueMode);
  const capFact = paymentTermsCapFor(company.countryCode ?? '');
  const cap: PaymentTermCap | null = capFact
    ? { maxNetDays: capFact.maxNetDays, maxEndOfMonthDays: capFact.maxEndOfMonthDays }
    : null;
  const countryFallback = fallbackPaymentTermFor(company.countryCode ?? '');
  const countryInvoiceFallback: DueDateTerm | null = countryFallback
    ? { days: countryFallback.days, mode: 'net' }
    : null;
  return {
    quote,
    invoice,
    cap,
    countryInvoiceFallback,
    exceedsCap: { quote: exceeds(quote, cap), invoice: exceeds(invoice, cap) },
  };
}

/** The term a new invoice's due date is computed from: the company's own, else its country's. */
export function effectiveInvoiceTerm(terms: ResolvedPaymentTerms): DueDateTerm | null {
  return terms.invoice ?? terms.countryInvoiceFallback;
}

/** The due date `term` gives for a calendar `issueDate` ("YYYY-MM-DD", a longer ISO string is cut to
 *  its day), counted in UTC calendar days. `undefined` when the issue date is not a real day. */
export function computeDueDate(issueDate: string, term: DueDateTerm): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(issueDate);
  if (!match) return undefined;
  const due = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + term.days));
  if (Number.isNaN(due.getTime())) return undefined;
  const result =
    term.mode === 'endOfMonth' ? new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)) : due;
  return result.toISOString().slice(0, 10);
}

/** `undefined` leaves the column untouched, `null`/`''` clears it, anything else must be a whole
 *  number of days in range. */
export function normalizeDueDays(field: string, value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (value as unknown) === '') return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_DUE_DAYS) {
    throw new BadRequestException(`${field} must be a whole number of days between 0 and ${MAX_DUE_DAYS}.`);
  }
  return value;
}

export function normalizeDueMode(field: string, value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  if (value !== 'net' && value !== 'endOfMonth') {
    throw new BadRequestException(`${field} must be "net" or "endOfMonth" (or empty), not "${value}".`);
  }
  return value;
}

/**
 * Subscription invoices issued by Invoicerr itself (#760, #971 slice 10).
 *
 * Stripe collects the payment; the invoice the subscriber receives is an ordinary Invoicerr invoice,
 * issued by the publisher's own company on this instance, so it goes through the same numbering, tax
 * engine, Factur-X and transmission path as every other invoice.
 *
 * 1. Recording: the Stripe webhook (`stripe-plugin.ts`, `onEvent`) stores one `SubscriptionInvoice` row
 *    per paid Stripe invoice (`invoice.paid`), idempotently on the Stripe invoice id. A failed write
 *    throws, so Stripe retries the event. Nothing else happens inside the webhook.
 * 2. Issuing: the billing sweep (`subscription-invoice-issuer.ts`) turns each pending row into an
 *    invoice of the company named in `BILLING_INVOICE_ISSUER_COMPANY_ID`: the subscriber becomes a
 *    client of that company (created once), the Stripe lines become invoice lines, then the invoice is
 *    sent with that company's own transport. Unset, rows wait and nothing is issued.
 *
 * VAT is decided by the issuer company's own settings, as for any other invoice: under the franchise
 * (`exemptVat`) every line goes to 0% with the art. 293 B mention, and an EU business client with a
 * VAT number gets the reverse charge. The line rate given here is only the French standard rate.
 *
 * A Stripe invoice is refused for automatic issuing, and kept with its reason, when it carries a
 * negative line (a proration credit), a discount, or more lines than the event holds: Invoicerr lines
 * are never negative, and folding a credit into another line would misstate what was sold.
 */
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

/** The webhook event that records a payment. */
export const PAID_INVOICE_EVENT = 'invoice.paid';

/** Starts `lastError` on a row the issuer must leave to the operator. */
export const MANUAL_ISSUE_PREFIX = 'Not issued automatically';

/** One Stripe line, as kept on the row: amounts in the currency's minor unit, tax excluded. */
export interface SubscriptionInvoiceLine {
  description: string;
  amount: number;
  quantity: number | null;
  periodStart: number | null;
  periodEnd: number | null;
}

/** The fields of a Stripe invoice this module reads. */
export interface PaidStripeInvoice {
  id?: string | null;
  customer?: string | { id: string } | null;
  currency?: string | null;
  amount_paid?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  lines?: {
    has_more?: boolean | null;
    data?: Array<{
      description?: string | null;
      amount?: number | null;
      quantity?: number | null;
      period?: { start?: number | null; end?: number | null } | null;
      discount_amounts?: Array<{ amount?: number | null }> | null;
    }> | null;
  } | null;
}

export interface SubscriptionInvoiceRecord {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  currency: string;
  /** What Stripe collected, tax included, in the currency's minor unit. */
  amountPaid: number;
  lines: SubscriptionInvoiceLine[];
  paidAt: Date;
  /** Why this invoice cannot be issued automatically, or null. */
  problem: string | null;
}

export type ParsedPaidInvoice =
  | { kind: 'ignored'; reason: string }
  | { kind: 'paid'; record: SubscriptionInvoiceRecord };

const customerIdOf = (customer: PaidStripeInvoice['customer']): string =>
  typeof customer === 'string' ? customer : (customer?.id ?? '');

/** What a paid Stripe invoice turns into. A zero invoice (a trial start) sells nothing and is ignored. */
export function parsePaidStripeInvoice(invoice: PaidStripeInvoice): ParsedPaidInvoice {
  const id = (invoice.id ?? '').trim();
  if (!id) return { kind: 'ignored', reason: 'no invoice id' };
  const stripeCustomerId = customerIdOf(invoice.customer).trim();
  if (!stripeCustomerId) return { kind: 'ignored', reason: 'no customer' };
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return { kind: 'ignored', reason: 'nothing paid' };

  const rawLines = invoice.lines?.data ?? [];
  const lines: SubscriptionInvoiceLine[] = rawLines.map((line) => ({
    description: (line.description ?? '').trim(),
    amount: line.amount ?? 0,
    quantity: line.quantity ?? null,
    periodStart: line.period?.start ?? null,
    periodEnd: line.period?.end ?? null,
  }));

  let problem: string | null = null;
  if (invoice.lines?.has_more) problem = 'more lines than the event holds';
  else if (lines.length === 0) problem = 'no lines';
  else if (lines.some((line) => line.amount < 0)) problem = 'a negative line (credit)';
  else if (rawLines.some((line) => (line.discount_amounts ?? []).some((d) => (d.amount ?? 0) > 0)))
    problem = 'a discount';

  const paidAtSeconds = invoice.status_transitions?.paid_at;
  return {
    kind: 'paid',
    record: {
      stripeInvoiceId: id,
      stripeCustomerId,
      currency: (invoice.currency ?? '').trim().toUpperCase(),
      amountPaid: invoice.amount_paid,
      lines,
      paidAt: paidAtSeconds ? new Date(paidAtSeconds * 1000) : new Date(),
      problem,
    },
  };
}

export interface StripeWebhookEvent {
  type: string;
  data: { object: unknown };
}

/**
 * Stores a paid Stripe invoice once (a replayed event changes nothing). Any other event is ignored.
 * The subscribing company is found from its Stripe customer; a customer without a company (a
 * pre-order not claimed yet) is still recorded, and the issuer reports it.
 */
export async function recordPaidSubscriptionInvoiceEvent(event: StripeWebhookEvent): Promise<void> {
  if (event.type !== PAID_INVOICE_EVENT) return;
  const parsed = parsePaidStripeInvoice(event.data.object as PaidStripeInvoice);
  if (parsed.kind === 'ignored') return;
  const { record } = parsed;

  const company = await prisma.company.findUnique({
    where: { stripeCustomerId: record.stripeCustomerId },
    select: { id: true },
  });
  const { count } = await prisma.subscriptionInvoice.createMany({
    data: [
      {
        stripeInvoiceId: record.stripeInvoiceId,
        stripeCustomerId: record.stripeCustomerId,
        companyId: company?.id ?? null,
        currency: record.currency,
        amountPaid: record.amountPaid,
        lines: record.lines as unknown as object,
        paidAt: record.paidAt,
        lastError: record.problem ? `${MANUAL_ISSUE_PREFIX}: ${record.problem}` : null,
      },
    ],
    skipDuplicates: true,
  });
  if (count > 0 && record.problem) {
    logger.warn('Paid Stripe invoice needs a manual Invoicerr invoice', {
      category: 'billing',
      details: { stripeInvoiceId: record.stripeInvoiceId, problem: record.problem },
    });
  }
}

/** The company that issues the subscription invoices, or null when none is configured. */
export function readInvoiceIssuerCompanyId(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env.BILLING_INVOICE_ISSUER_COMPANY_ID ?? '').trim();
  return value === '' ? null : value;
}

const isoDay = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The Invoicerr invoice lines of a Stripe invoice: one line each, quantity 1, the Stripe amount as
 *  price. Graduated seat tiers make a per-seat price inexact, so the seat count stays in the text. */
export function toInvoiceLines(lines: SubscriptionInvoiceLine[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const period =
      line.periodStart && line.periodEnd ? ` (${isoDay(line.periodStart)} to ${isoDay(line.periodEnd)})` : '';
    return {
      description: `${line.description || 'Invoicerr subscription'}${period}`,
      quantity: 1,
      unit: 'unit',
      unitPrice: line.amount / 100,
      vatRate: '20',
    };
  });
}

/** The lines a row stores (what the webhook parsed); anything malformed is dropped. */
export function readStoredLines(value: unknown): SubscriptionInvoiceLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (line): line is SubscriptionInvoiceLine =>
      typeof line === 'object' &&
      line !== null &&
      typeof (line as SubscriptionInvoiceLine).amount === 'number',
  );
}

import { ConflictException } from '@nestjs/common';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { findInvoicesRaisedFromQuote } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { DocumentInstanceResult } from './action-registry';

/**
 * The one place that answers "may this quote be invoiced AGAIN?" for all three quote->invoice
 * actions ("convert-to-invoice", "request-deposit", "request-installments"), and refuses (409) when
 * the answer is no. Added for #953: those actions never change the QUOTE's own status
 * (quote.descriptor.ts's "convert-to-invoice"/"request-deposit" declare no transition at all), so
 * before this guard a conversion could be replayed indefinitely and a conversion, a deposit and an
 * installment plan could all pile up on the same quote - with the installment plan then summing the
 * full price on top of an already-invoiced deposit.
 *
 * The only second invoice ever allowed is the one combination a real workflow needs: a DEPOSIT,
 * followed by an installment plan that DEDUCTS it (so what the client pays in total still comes back
 * to the quote's own total). Everything else - converting twice, a second deposit, an installment
 * plan on top of a conversion or on top of another plan - is a 409.
 *
 * Which invoice is "the deposit" is a fact this app itself writes (see `QUOTE_DEPOSIT_PERCENT_KEY`),
 * never guessed from an amount or a line description: a partial-looking invoice is not necessarily a
 * deposit (a multi-option conversion only copies the accepted option's lines), and the guard must
 * never invoice around a conversion on the strength of its total.
 */
export const QUOTE_DEPOSIT_PERCENT_KEY = 'depositPercent';

/**
 * The invoice's OWN descriptor, for the same reason request-deposit.ts holds one: the already
 * invoiced amount is read back with `computeDocumentTotals`, i.e. exactly what each of those invoices
 * itself totals (and therefore what their client was actually asked to pay), never a figure
 * recomputed here from the quote.
 */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export interface QuoteInvoicesRaised {
  /** Every invoice carrying `origin = { entity: 'quote', id: quoteId }`, oldest first. */
  invoices: DocumentInstanceResult[];
  /** What the client has ALREADY been asked to pay as a deposit against this quote, minor units. */
  depositGrossMinor: number;
}

/** Reads both facts in one go - the guard's own two questions are always asked together. */
export async function invoicesRaisedFromQuote(
  companyId: string,
  quoteId: string,
): Promise<QuoteInvoicesRaised> {
  const invoices = await findInvoicesRaisedFromQuote(companyId, quoteId);
  const depositGrossMinor = invoices
    .filter(isDepositInvoice)
    .reduce(
      (sum, invoice) =>
        sum +
        computeDocumentTotals(INVOICE_DESCRIPTOR, (invoice.data ?? {}) as Record<string, unknown>).grossMinor,
      0,
    );
  return { invoices, depositGrossMinor };
}

/**
 * Was this invoice raised as a DEPOSIT against its quote? True only for the marker
 * `request-deposit.ts` stamps on every invoice it creates (`depositPercent`: the N% the deposit was
 * computed from). An invoice without it is a conversion or an installment milestone, which nothing
 * may ever be invoiced on top of.
 */
export function isDepositInvoice(invoice: DocumentInstanceResult): boolean {
  const data = (invoice.data ?? {}) as Record<string, unknown>;
  return typeof data[QUOTE_DEPOSIT_PERCENT_KEY] === 'number';
}

/** 409 unless this quote has never been invoiced at all - the rule "convert-to-invoice" and
 *  "request-deposit" share: any invoice raised from a quote already IS the quote's invoice. */
export function assertNothingRaisedYet(
  raised: QuoteInvoicesRaised,
  quoteLabel: string,
  actionLabel: string,
): void {
  if (raised.invoices.length === 0) return;
  throw new ConflictException({
    message:
      `Cannot ${actionLabel} quote "${quoteLabel}": ${describeRaised(raised.invoices)} already ` +
      'billed it. Refusing to invoice the same quote twice.',
    code: 'QUOTE_ALREADY_INVOICED',
    params: { invoiceIds: raised.invoices.map((invoice) => invoice.id) },
  });
}

/** 409 unless the only invoice ever raised from this quote is its deposit - the rule
 *  "request-installments" holds: an installment plan is the one action allowed after a deposit, and
 *  it then DEDUCTS it (`QuoteInvoicesRaised.depositGrossMinor`). */
export function assertOnlyDepositRaised(raised: QuoteInvoicesRaised, quoteLabel: string): void {
  const blocking = raised.invoices.filter((invoice) => !isDepositInvoice(invoice));
  if (blocking.length === 0) return;
  throw new ConflictException({
    message:
      `Cannot generate installment invoices for quote "${quoteLabel}": ${describeRaised(blocking)} ` +
      'already billed it (only a deposit may precede an installment plan, and the plan deducts it). ' +
      'Refusing to invoice the same quote twice.',
    code: 'QUOTE_ALREADY_INVOICED',
    params: { invoiceIds: blocking.map((invoice) => invoice.id) },
  });
}

/** "invoice INV-2026-0001" / "invoices INV-1, INV-2" - the label list an error message names. */
function describeRaised(invoices: DocumentInstanceResult[]): string {
  const labels = invoices.map((invoice) => invoice.displayNumber ?? invoice.id).join(', ');
  return invoices.length === 1 ? `invoice ${labels}` : `invoices ${labels}`;
}

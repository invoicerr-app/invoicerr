import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { computeDocumentTotals } from '../totals/compute-totals';
import { computeSettlement } from './compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from './credits';
import { sumPaidMinorByDocument } from './payments';

/**
 * The "sent AND not settled" predicate that both invoice-contributions.ts's "pending invoices"
 * dashboard tile and `GET /documents`'s own `settlement=unsettled` list filter (list-documents.dto.ts,
 * documents.service.ts) apply. Extracted here, out of invoice-contributions.ts (where it was born),
 * so a metric tile promising "click through to see these" and the list behind that click can never
 * independently drift on what "pending" means. A "draft" is never pending (not yet issued), a
 * "cancelled" invoice is excluded for free (`status === 'sent'` is a strict equality, never a
 * "not draft" negation, see invoice-contributions.ts's own header for why that matters), and a "sent"
 * invoice already fully paid and/or credited (`settlement/compute-settlement.ts`,
 * `settlement/credits.ts`) is settled, not pending.
 *
 * Runs the same two extra reads invoice-contributions.ts always has, batched once for every candidate
 * invoice (never one query per document): `sumPaidMinorByDocument` and `listCreditNotes`.
 */
export async function filterUnsettledInvoices(
  companyId: string,
  invoiceDescriptor: DocumentTypeDescriptor,
  invoices: readonly DocumentInstanceResult[],
): Promise<DocumentInstanceResult[]> {
  const sentInvoices = invoices.filter((invoice) => invoice.status === 'sent');
  const paidMinorByDocument = await sumPaidMinorByDocument(
    companyId,
    sentInvoices.map((invoice) => invoice.id),
  );
  const creditNotes = await listCreditNotes(companyId);

  return sentInvoices.filter((invoice) => {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const grossMinor = computeDocumentTotals(invoiceDescriptor, data).grossMinor;
    const paidMinor = paidMinorByDocument.get(invoice.id) ?? 0;
    const { credits } = creditsForInvoiceFromNotes(creditNotes, invoice.id, invoiceDescriptor, data);
    return !computeSettlement(grossMinor, [{ amountMinor: paidMinor }], toSettlementCreditInputs(credits))
      .settled;
  });
}

/**
 * `dueDate < today` (UTC, compared as `YYYY-MM-DD` strings, same clock convention as
 * invoice-contributions.ts's own `monthKey`) on an ALREADY-unsettled invoice: the "overdue" half of
 * `filterUnsettledInvoices` above, shared because the "Overdue invoices" tile and `settlement=overdue`
 * must apply exactly the same rule. Takes `todayIso` rather than reading the clock itself so a caller
 * filtering many invoices computes "today" once, not once per row.
 */
export function isOverdueInvoice(invoice: DocumentInstanceResult, todayIso: string): boolean {
  const data = (invoice.data ?? {}) as Record<string, unknown>;
  const dueDate = typeof data.dueDate === 'string' ? data.dueDate.slice(0, 10) : '';
  return dueDate !== '' && dueDate < todayIso;
}

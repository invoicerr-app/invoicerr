import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listAllDocuments } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { computeSettlement } from '../settlement/compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from '../settlement/credits';
import { sumPaidMinorByDocument } from '../settlement/payments';
import { resolveClientLabels } from '../accounting-export/client-labels';
import { MatchCandidateInvoice } from './matching';

/**
 * Every "sent" invoice this company still has an OUTSTANDING balance on — the pool
 * `bank-reconciliation.service.ts` matches a statement's lines against, and what a manual
 * reconciliation's own invoice picker offers. Same "gather + compute, never recompute a balance"
 * discipline `settlement/client-statement.ts`/`accounting-export/accounting-export.service.ts` already
 * hold (this file's own header copies theirs): every figure comes from
 * `computeDocumentTotals`/`computeSettlement`, reused verbatim — this file only decides WHICH invoices
 * qualify at all.
 *
 * "sent" only, `outstandingMinor > 0` only — a draft was never actually issued (nothing owed yet, on
 * record), and a fully settled or cancelled invoice has nothing left for a bank line to pay off. The
 * exact same filter `client-statement.ts` already applies for the identical reason.
 */

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export async function resolveOutstandingInvoices(companyId: string): Promise<MatchCandidateInvoice[]> {
  // Every sent invoice, "sent" pushed into SQL, paged until exhausted (`listAllDocuments`). The pool
  // a bank line is matched against must be the WHOLE pool: an invoice missing from it is not merely
  // absent from a screen, it is an incoming payment that silently finds no invoice to settle — and
  // the invoices an `updatedAt`-ordered capped read dropped first were the long-unpaid ones, the very
  // population a bank statement is most likely to be paying off.
  const sentInvoices = await listAllDocuments(companyId, { typeId: 'invoice', status: ['sent'] });

  const paidByDocument = await sumPaidMinorByDocument(
    companyId,
    sentInvoices.map((invoice) => invoice.id),
  );
  // Company-wide, ONE query — the same "one query, many callers" shape `sumPaidMinorByDocument` itself
  // already gives payments, and `client-statement.ts`'s own dashboard-adjacent read already gives
  // credit notes: cheaper than one `listCreditNotes` per candidate invoice.
  const creditNotes = await listCreditNotes(companyId);

  interface DraftCandidate extends MatchCandidateInvoice {
    clientId: string | null;
  }
  const drafts: DraftCandidate[] = [];

  for (const invoice of sentInvoices) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
    const paidMinor = paidByDocument.get(invoice.id) ?? 0;
    const { credits } = creditsForInvoiceFromNotes(creditNotes, invoice.id, INVOICE_DESCRIPTOR, data);
    const settlement = computeSettlement(
      totals.grossMinor,
      [{ amountMinor: paidMinor }],
      toSettlementCreditInputs(credits),
    );
    if (settlement.outstandingMinor <= 0) continue;

    drafts.push({
      documentId: invoice.id,
      displayNumber: invoice.displayNumber ?? null,
      clientLabel: null, // resolved below, once every id is known — the same two-pass shape
      // `accounting-export.service.ts` already uses for its own "client" column.
      clientId: typeof data.client === 'string' ? data.client : null,
      currency: typeof data.currency === 'string' ? data.currency : '',
      outstandingMinor: settlement.outstandingMinor,
      issueDate: typeof data.issueDate === 'string' ? data.issueDate : null,
      dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
    });
  }

  const clientIds = drafts.map((draft) => draft.clientId).filter((id): id is string => id !== null);
  const labels = await resolveClientLabels(companyId, clientIds);

  return drafts.map(({ clientId, ...candidate }) => ({
    ...candidate,
    clientLabel: clientId ? (labels.get(clientId) ?? null) : null,
  }));
}

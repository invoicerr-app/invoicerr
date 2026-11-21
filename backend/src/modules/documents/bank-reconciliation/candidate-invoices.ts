import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listAllDocuments } from '../persistence';
import { resolveInvoiceBalances } from '../settlement/unsettled-invoices';
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
 * "sent"/"imported", `outstandingMinor > 0` only: a draft was never actually issued (nothing owed
 * yet, on record), and a fully settled or cancelled invoice has nothing left for a bank line to pay
 * off. The exact same status set `client-statement.ts`/`settlement/unsettled-invoices.ts` already
 * apply. "imported" (issue #340): recording a payment is one of the few actions the owner's own
 * decision allows on a historical invoice, and reconciling it against a real bank line is the same
 * action, just found automatically instead of typed by hand. Excluding it here would mean the ONLY
 * way to ever pay one off is the manual "record payment" dialog.
 */

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export async function resolveOutstandingInvoices(companyId: string): Promise<MatchCandidateInvoice[]> {
  // Every sent/imported invoice, pushed into SQL, paged until exhausted (`listAllDocuments`). The
  // pool a bank line is matched against must be the WHOLE pool: an invoice missing from it is not
  // merely absent from a screen, it is an incoming payment that silently finds no invoice to settle,
  // and the invoices an `updatedAt`-ordered capped read dropped first were the long-unpaid ones, the
  // very population a bank statement is most likely to be paying off.
  const sentInvoices = await listAllDocuments(companyId, {
    typeId: 'invoice',
    status: ['sent', 'imported'],
  });

  // Payments and credit notes read once for the whole pool, never once per candidate invoice.
  const balances = await resolveInvoiceBalances(companyId, INVOICE_DESCRIPTOR, sentInvoices);

  interface DraftCandidate extends MatchCandidateInvoice {
    clientId: string | null;
  }
  const drafts: DraftCandidate[] = [];

  for (const { invoice, settlement } of balances) {
    if (settlement.outstandingMinor <= 0) continue;
    const data = (invoice.data ?? {}) as Record<string, unknown>;

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
      conformityRejected: Boolean(invoice.conformityRejectedAt),
    });
  }

  const clientIds = drafts.map((draft) => draft.clientId).filter((id): id is string => id !== null);
  const labels = await resolveClientLabels(companyId, clientIds);

  return drafts.map(({ clientId, ...candidate }) => ({
    ...candidate,
    clientLabel: clientId ? (labels.get(clientId) ?? null) : null,
  }));
}

/**
 * The payment-data hook  -  the second trigger of the same declarative-reporting mechanism, called
 * after a payment is recorded on an invoice.
 *
 * Why it is separate from `report-on-send.ts`: CGI art. 290 A targets payment data of operations
 * whose VAT is due on collection, which is a fact about the PAYMENT, not about the invoice's own
 * delivery. A payment can be recorded weeks after the invoice was sent, and a later payment on the
 * same invoice is another declaration, so the report job carries the payment's own id.
 *
 * Never throws, exactly like `report-on-send.ts`: recording money must not fail because a
 * declaration could not be enqueued, and a missing/enqueueing failure is journaled with the
 * obligation's own provider id so the Declarations screen can show it. The resolution lives in
 * `on-document-event.ts` (issue #768); this file only adapts the payment action's input to it.
 */
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { defaultReportingObligationCatalogV2, ReportingObligationCatalogV2 } from './obligation-catalog';
import { reportOnDocumentEvent } from './on-document-event';

export interface ReportPaymentInput {
  companyId: string;
  documentId: string;
  paymentId: string;
  typeId?: string;
  amountMinor: number;
  paidAt: string;
  queueDispatcher: DocumentActionQueueDispatcher;
}

/** Called from the invoice's "record-payment" handler, unconditionally, after the row is written. */
export async function reportPaymentIfObligated(
  input: ReportPaymentInput,
  catalog: ReportingObligationCatalogV2 = defaultReportingObligationCatalogV2,
): Promise<void> {
  const {
    companyId,
    documentId,
    paymentId,
    typeId = 'invoice',
    amountMinor,
    paidAt,
    queueDispatcher,
  } = input;
  await reportOnDocumentEvent(
    {
      event: 'payment',
      companyId,
      typeId,
      documentId,
      queueDispatcher,
      payment: { paymentId, amountMinor, paidAt },
    },
    catalog,
  );
}

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
 * obligation's own provider id so the Declarations screen can show it.
 */
import { logger } from '@/logger/logger.service';

import { journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { classifyDeclaration } from './classify';
import { loadDeclarationOperation } from './operation-context';
import { REPORT_BLOCKED_STATUS_CODE, REPORT_FAILED_STATUS_CODE } from './report-job';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

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
  catalog: ReportingObligationCatalog = defaultReportingObligationCatalog,
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
  if (!queueDispatcher.enqueueReport) return;

  let obligation: ReturnType<ReportingObligationCatalog['obligationFor']>;
  let blocked: { providerId: string; reason: string } | undefined;
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return;
    const facts = catalog.providerFactsFor(countryCode, typeId);
    if (facts.length === 0) return;

    const operation = await loadDeclarationOperation({
      companyId,
      typeId,
      documentId,
      kind: 'payment',
      payment: { amountMinor, paidAt },
    });
    for (const fact of facts) {
      const verdict = classifyDeclaration(fact, operation);
      if (verdict.status === 'in') {
        obligation = fact;
        break;
      }
      if (verdict.status === 'undetermined' && !blocked) {
        blocked = { providerId: fact.providerId, reason: verdict.reason };
      }
    }
  } catch (error) {
    logger.error('Failed to resolve a payment reporting obligation', {
      category: 'documents',
      details: {
        companyId,
        documentId,
        paymentId,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  if (!obligation) {
    if (blocked) {
      try {
        await journalSyntheticEvent(
          companyId,
          documentId,
          blocked.providerId,
          REPORT_BLOCKED_STATUS_CODE,
          blocked.reason,
        );
      } catch (journalError) {
        logger.error('Could not journal a blocked payment declaration', {
          category: 'documents',
          details: {
            companyId,
            documentId,
            paymentId,
            providerId: blocked.providerId,
            message: journalError instanceof Error ? journalError.message : String(journalError),
          },
        });
      }
    }
    return;
  }

  try {
    await queueDispatcher.enqueueReport({
      companyId,
      documentId,
      typeId,
      providerId: obligation.providerId,
      paymentId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to enqueue a payment declaration', {
      category: 'documents',
      details: { companyId, documentId, paymentId, providerId: obligation.providerId, message },
    });
    try {
      await journalSyntheticEvent(
        companyId,
        documentId,
        obligation.providerId,
        REPORT_FAILED_STATUS_CODE,
        `Could not enqueue the payment declaration job: ${message}`,
      );
    } catch (journalError) {
      logger.error('Could not even journal a payment report failure', {
        category: 'documents',
        details: {
          companyId,
          documentId,
          paymentId,
          providerId: obligation.providerId,
          originalMessage: message,
          journalMessage: journalError instanceof Error ? journalError.message : String(journalError),
        },
      });
    }
  }
}

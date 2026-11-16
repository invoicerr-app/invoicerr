/**
 * The one hook every document event calls to enqueue the declarations it makes due (issue #768).
 *
 * Three callers, one per event:
 *   - `issued`: the invoice "validate" action, once the document is numbered and locked without being
 *     sent (`actions/invoice-actions.ts`);
 *   - `sent`: `actions/async-send.ts`, after the delivery and the "sent" write (`report-on-send.ts`);
 *   - `payment`: the invoice "record-payment" action, after the payment row is written
 *     (`report-payment.ts`).
 *
 * Each event asks the v2 catalog for the provider obligations of the seller's country whose
 * `trigger` it fires, classifies each against the operation (`classify.ts`), and enqueues the first
 * one that covers it. A `sent` event also fires the `issued` obligations: a document sent straight
 * from draft is issued by that send, and one validated earlier has already been declared, which the
 * runner checks against the journal before declaring again (`reporting-runner.ts`). A periodic
 * (`period-end`) obligation is never fired by a document event.
 *
 * ## Never silent, never throwing
 *
 * This function NEVER throws: the event it follows has already happened (a numbered invoice, a
 * delivered invoice, recorded money) and must not look failed because its declaration could not be
 * enqueued. Every outcome that matters is journaled on the document's own `DocumentAuthorityEvent`
 * timeline, under the obligation's own provider id, so the Declarations screen
 * (`list-declarations.ts`) shows it:
 *   - an operation the law may cover but whose facts are missing (no client type, no company size
 *     category) is journaled `report:blocked` with the classifier's reason, never declared on a guess;
 *   - an enqueue failure (a Redis hiccup) is journaled `report:failed`, the same code the runner uses
 *     once every retry is exhausted: from the screen's point of view both mean "this declaration will
 *     not happen on its own".
 * Resolving whether an obligation exists at all failing is only logged: there is no provider id yet
 * to journal it under.
 *
 * A country with no provider obligation for the event returns at once, having read nothing else.
 */
import { logger } from '@/logger/logger.service';

import { journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { classifyObligation, DeclarationOperation } from './classify';
import { defaultReportingObligationCatalogV2, ReportingObligationCatalogV2 } from './obligation-catalog';
import { ObligationTrigger } from './obligation-v2';
import { loadDeclarationOperation } from './operation-context';
import { REPORT_BLOCKED_STATUS_CODE, REPORT_FAILED_STATUS_CODE } from './report-job';

export type DocumentEvent = 'issued' | 'sent' | 'payment';

/** Which obligation triggers each document event fires. */
export const TRIGGERS_FIRED_BY: Record<DocumentEvent, readonly ObligationTrigger[]> = {
  issued: ['issued'],
  sent: ['issued', 'sent'],
  payment: ['payment'],
};

export interface DocumentEventInput {
  event: DocumentEvent;
  companyId: string;
  typeId: string;
  documentId: string;
  queueDispatcher: DocumentActionQueueDispatcher;
  /** Required for a `payment` event: the recorded payment the declaration is about. */
  payment?: { paymentId: string; amountMinor: number; paidAt: string };
}

/** How each event names itself in a log line. */
const EVENT_LABEL: Record<DocumentEvent, string> = {
  issued: 'an issuance',
  sent: 'a successful send',
  payment: 'a recorded payment',
};

export async function reportOnDocumentEvent(
  input: DocumentEventInput,
  catalog: ReportingObligationCatalogV2 = defaultReportingObligationCatalogV2,
): Promise<void> {
  const { event, companyId, typeId, documentId, queueDispatcher, payment } = input;
  // A dispatcher with no `enqueueReport` (the bare `{ enqueueAction }` mocks many action specs use,
  // see `queue/queue.constants.ts`) cannot report: no capability, no effect, never a crash.
  if (!queueDispatcher.enqueueReport) return;
  const details = { companyId, typeId, documentId, event, paymentId: payment?.paymentId };
  if (event === 'payment' && !payment) {
    logger.error('A payment event reached the declaration hook without its payment', {
      category: 'documents',
      details,
    });
    return;
  }

  let providerId: string | undefined;
  let blocked: { providerId: string; reason: string } | undefined;
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return;
    const triggers = TRIGGERS_FIRED_BY[event];
    const candidates = catalog
      .providerObligationsFor(countryCode, typeId)
      .filter((candidate) => triggers.includes(candidate.trigger))
      .flatMap((candidate) => {
        const id = ReportingObligationCatalogV2.providerChannelId(candidate);
        return id ? [{ candidate, providerId: id }] : [];
      });
    if (candidates.length === 0) return;

    // An unscoped obligation with no window and no seller condition (Portugal's) needs no operation
    // facts, so it never reads the client or the articles. A payment always does: its classifier
    // judges the invoice's lines and the seller's VAT-on-collection option.
    const needsOperation =
      event === 'payment' ||
      candidates.some(
        ({ candidate }) =>
          candidate.scope.transactions || candidate.applicability || candidate.sellerConditions,
      );
    const operation: DeclarationOperation | undefined = needsOperation
      ? await loadDeclarationOperation({
          companyId,
          typeId,
          documentId,
          kind: event === 'payment' ? 'payment' : 'invoice',
          payment: payment ? { amountMinor: payment.amountMinor, paidAt: payment.paidAt } : undefined,
        })
      : undefined;
    for (const candidate of candidates) {
      const verdict = classifyObligation(candidate.candidate, operation);
      if (verdict.status === 'in') {
        providerId = candidate.providerId;
        break;
      }
      // A later obligation may still cover the operation: only the absence of ANY covering one makes
      // this a blocked declaration.
      if (verdict.status === 'undetermined' && !blocked) {
        blocked = { providerId: candidate.providerId, reason: verdict.reason };
      }
    }
  } catch (error) {
    logger.error(`Failed to resolve a reporting obligation after ${EVENT_LABEL[event]}`, {
      category: 'documents',
      details: { ...details, message: error instanceof Error ? error.message : String(error) },
    });
    return;
  }

  if (!providerId) {
    if (blocked) {
      await journalOrLog(
        companyId,
        documentId,
        blocked.providerId,
        REPORT_BLOCKED_STATUS_CODE,
        blocked.reason,
        {
          ...details,
          providerId: blocked.providerId,
        },
      );
    }
    return;
  }

  try {
    await queueDispatcher.enqueueReport({
      companyId,
      documentId,
      typeId,
      providerId,
      ...(payment ? { paymentId: payment.paymentId } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to enqueue a declaration after ${EVENT_LABEL[event]}`, {
      category: 'documents',
      details: { ...details, providerId, message },
    });
    await journalOrLog(
      companyId,
      documentId,
      providerId,
      REPORT_FAILED_STATUS_CODE,
      `Could not enqueue the ${payment ? 'payment ' : ''}declaration job: ${message}`,
      { ...details, providerId, originalMessage: message },
    );
  }
}

/** Journals a synthetic declaration event, and only logs if even that write fails. */
async function journalOrLog(
  companyId: string,
  documentId: string,
  providerId: string,
  statusCode: string,
  reason: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const journaled = await journalSyntheticEvent(companyId, documentId, providerId, statusCode, reason);
    if (journaled === 0) {
      // A dedup no-op (`DocumentAuthorityEvent`'s own `@@unique`): an earlier attempt already
      // journaled this same code for this document.
      logger.info(`${statusCode} for document ${documentId} ("${providerId}") was already journaled.`, {
        category: 'documents',
      });
    }
  } catch (journalError) {
    logger.error(`Could not journal ${statusCode} for document ${documentId} ("${providerId}")`, {
      category: 'documents',
      details: {
        ...details,
        journalMessage: journalError instanceof Error ? journalError.message : String(journalError),
      },
    });
  }
}

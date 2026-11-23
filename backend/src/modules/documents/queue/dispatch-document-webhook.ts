/**
 * `dispatchDocumentWebhookSafely`: the best-effort send of one `DOCUMENT_*` webhook, written once for
 * every call site. Kept apart from `document-webhooks.ts` so that file stays the pure wire shape with
 * no Nest/Prisma-service import (see its header); the shared `logger` lives here instead.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { runWithCompanyId } from '@/lib/request-context';
import { logger } from '@/logger/logger.service';

import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from './document-webhooks';

/** How `dispatchDocumentWebhookSafely` logs a failed dispatch. */
export interface DocumentWebhookFailureLog {
  /** The exact `logger.error` message for this call site. */
  failureMessage: string;
  /** Spread into the payload after the base fields (`buildDocumentWebhookPayload`). */
  extra?: Record<string, unknown>;
}

/**
 * Dispatches one `DOCUMENT_*` webhook and NEVER throws: the write it announces already happened, so a
 * third party's endpoint being down must never undo it or surface past it. A failure is logged loudly
 * instead (`category: 'documents'`). `webhooks` absent means "no capability wired, no effect".
 *
 * The dispatch runs inside `runWithCompanyId(companyId, …)`, so the failure log carries this company
 * whatever the caller's own context: a request, a queue worker, a sweep, or the `@Public()` signature
 * route (no active company, `companyId` resolved from the signature token). The log's `documentId` is
 * `document.id`, the row this webhook announces.
 */
export async function dispatchDocumentWebhookSafely<TDocument extends { id: string }>(
  webhooks: DocumentWebhookEmitter | undefined,
  event: WebhookEvent,
  companyId: string,
  typeId: string,
  document: TDocument,
  { failureMessage, extra }: DocumentWebhookFailureLog,
): Promise<void> {
  if (!webhooks) return;
  return runWithCompanyId(companyId, async () => {
    try {
      await webhooks.dispatch(event, buildDocumentWebhookPayload(companyId, typeId, document, extra));
    } catch (error) {
      logger.error(failureMessage, {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId: document.id,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

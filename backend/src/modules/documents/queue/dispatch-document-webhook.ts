/**
 * `dispatchDocumentWebhookSafely`: the best-effort send of one `DOCUMENT_*` webhook, written once for
 * every call site. Kept apart from `document-webhooks.ts` so that file stays the pure wire shape with
 * no Nest/Prisma-service import (see its header); the shared `logger` lives here instead.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { logger } from '@/logger/logger.service';

import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from './document-webhooks';

/** How `dispatchDocumentWebhookSafely` logs a failed dispatch. */
export interface DocumentWebhookFailureLog {
  /** The exact `logger.error` message for this call site. */
  failureMessage: string;
  /** The `documentId` written into the log's `details`. */
  documentId: string;
  /** Spread into the payload after the base fields (`buildDocumentWebhookPayload`). */
  extra?: Record<string, unknown>;
  /** Also put `companyId` at the log's root, for a caller with no ambient company context. */
  logCompanyId?: boolean;
}

/**
 * Dispatches one `DOCUMENT_*` webhook and NEVER throws: the write it announces already happened, so a
 * third party's endpoint being down must never undo it or surface past it. A failure is logged loudly
 * instead (`category: 'documents'`). `webhooks` absent means "no capability wired, no effect".
 */
export async function dispatchDocumentWebhookSafely<TDocument extends { id: string }>(
  webhooks: DocumentWebhookEmitter | undefined,
  event: WebhookEvent,
  companyId: string,
  typeId: string,
  document: TDocument,
  { failureMessage, documentId, extra, logCompanyId }: DocumentWebhookFailureLog,
): Promise<void> {
  if (!webhooks) return;
  try {
    await webhooks.dispatch(event, buildDocumentWebhookPayload(companyId, typeId, document, extra));
  } catch (error) {
    logger.error(failureMessage, {
      category: 'documents',
      ...(logCompanyId ? { companyId } : {}),
      details: {
        companyId,
        typeId,
        documentId,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

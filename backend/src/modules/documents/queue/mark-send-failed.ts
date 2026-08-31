/**
 * The TERMINAL failure path for an async "send" — called from
 * queue/processors/document-action.processor.ts's `@OnWorkerEvent('failed')` handler, and ONLY once
 * BullMQ has exhausted every configured retry for the job (see that processor's own header for how it
 * tells "one more attempt coming" apart from "this was the last one").
 *
 * Deliberately a SEPARATE path from `actions/async-send.ts`'s own handler, never that handler
 * catching its own error: a transient failure (an SMTP hiccup, a momentarily-unreachable transport)
 * must be allowed to retry via BullMQ's own backoff — swallowing the error inside the action handler
 * would turn every attempt into an immediate, permanent "send_failed" and defeat the retry entirely.
 * This file is what runs ONLY once retrying has genuinely stopped making sense.
 *
 * Reuses `checkTransitionResult` (descriptors/lifecycle.ts) — the EXACT SAME enforcement
 * `DocumentsService.runAction` applies to every handler's own write — so a write landing here is
 * checked against the type's own declared lifecycle exactly like any other, even though it happens
 * completely outside `runAction` itself. See that function's own header for why this matters: without
 * this call, "send_failed" would be a status nothing ever confirmed the type's OWN lifecycle actually
 * allows from wherever the record was — a hole this whole mechanism exists to close.
 */
import { logger } from '@/logger/logger.service';

import { checkTransitionResult } from '../descriptors/lifecycle';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { findOwnedDocument, updateDocumentStatus } from '../persistence';

export interface MarkSendFailedInput {
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  error: Error;
}

/**
 * `resolveDescriptor` is a plain callback — `DocumentsService.getType` in production
 * (queue/processors/document-action.processor.ts) — rather than a `DocumentTypeRegistry` injected
 * here directly: this is the type's MERGED descriptor (native actions + whatever a third party
 * attached via `ActionExtensionRegistry`), the exact same shape `checkTransitionResult` is always
 * checked against everywhere else (documents.service.ts's own `runAction`), never the native-only one.
 */
export async function markSendFailed(
  resolveDescriptor: (typeId: string) => DocumentTypeDescriptor,
  input: MarkSendFailedInput,
): Promise<void> {
  const { companyId, typeId, documentId, actionId, error } = input;
  const descriptor = resolveDescriptor(typeId);
  const action = descriptor.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    // Cannot happen for a job this queue itself enqueued (actions/async-send.ts only ever enqueues
    // an action the SAME descriptor already declares) — a defensive, loud log rather than a throw
    // that would leave the record silently stuck at "sending" forever.
    logger.error('markSendFailed: no such action declared — the record is left at its current status', {
      category: 'documents',
      details: { companyId, typeId, documentId, actionId },
    });
    return;
  }

  const existing = await findOwnedDocument(companyId, typeId, documentId);
  // Idempotency: only a record STILL "sending" gets marked failed. A duplicate delivery of the same
  // BullMQ job (at-least-once delivery is the platform's own contract), or a race against a genuine
  // success landing first, must never clobber an already-"sent" record back to "send_failed".
  if (existing.status !== 'sending') {
    logger.info('markSendFailed: record already moved on — nothing to mark', {
      category: 'documents',
      details: { companyId, typeId, documentId, currentStatus: existing.status },
    });
    return;
  }

  const updated = await updateDocumentStatus(companyId, typeId, documentId, 'send_failed', error.message);

  const violation = checkTransitionResult(descriptor, typeId, action, documentId, existing.status, {
    document: updated,
    changed: true,
  });
  if (violation) {
    // Exactly the same discipline documents.service.ts's runAction holds for its own handlers: a
    // write outside the declared lifecycle is a thrown Error, never a phantom status quietly
    // reaching the database unnoticed.
    logger.error('Document action queue wrote a status outside its declared lifecycle', {
      category: 'documents',
      details: { typeId, actionId, ...violation },
    });
    throw new Error(
      `markSendFailed for "${actionId}" of document type "${typeId}" wrote status ` +
        `"${violation.actualStatus}" but its declared lifecycle requires one of ` +
        `"${violation.expectedStatuses.join('", "')}" here.`,
    );
  }

  logger.warn('Document action failed after every retry — marked "send_failed"', {
    category: 'documents',
    details: { companyId, typeId, documentId, actionId, error: error.message },
  });
}

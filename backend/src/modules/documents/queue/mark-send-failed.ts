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
import { NotFoundException } from '@nestjs/common';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { logger } from '@/logger/logger.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { checkTransitionResult } from '../descriptors/lifecycle';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { findOwnedDocument, updateDocumentStatus } from '../persistence';
import { DocumentEventPublisher } from './document-events';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from './document-webhooks';

export interface MarkSendFailedInput {
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  error: Error;
  /**
   * TODO_PRODUIT.md T1 / PLAN-V2 R8 — see `actions/async-send.ts`'s own `RunAsyncSendInput.events`
   * header for the full "why optional, why a nudge never the state" reasoning; this is the SAME
   * mechanism's third publish point (a "send_failed" terminal write is exactly as SSE-worthy as
   * "sending"/"sent" — the badge and the Retry button both key off this status). OPTIONAL for the
   * identical reason: every EXISTING spec of this function predates the field and must keep passing
   * unchanged. Production wiring (`document-action.processor.ts`) always threads one through.
   */
  events?: DocumentEventPublisher;
  /**
   * TODO_PRODUIT.md T2bis — `DOCUMENT_SEND_FAILED`, the terminal-failure twin of `async-send.ts`'s own
   * `DOCUMENT_SENT`: this is the ONE place a "send_failed" webhook is allowed to fire from, right
   * after the SAME acquired fact `events` above announces (Postgres already holds "send_failed",
   * checked against the type's own declared lifecycle) — never earlier, never for the idempotent
   * "already moved on"/"document gone" branches below, which acquire nothing new. OPTIONAL, the
   * identical "every EXISTING spec predates it, no capability, no effect" posture `events` already
   * holds. Production wiring (`document-action.processor.ts`) always threads a real one through.
   */
  webhooks?: DocumentWebhookEmitter;
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
  const { companyId, typeId, documentId, actionId, error, events, webhooks } = input;
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

  let existing: DocumentInstanceResult;
  try {
    existing = await findOwnedDocument(companyId, typeId, documentId);
  } catch (lookupError) {
    if (!(lookupError instanceof NotFoundException)) {
      throw lookupError;
    }
    // The twin case to "already moved on" below: the document itself is gone entirely — a resetAndSeed
    // racing this job's still-running BullMQ backoff in e2e, or any production deletion of a document
    // with a send in flight. Nothing left to mark, same tone as that other case, and specifically NOT a
    // rethrow: this runs from `onFailed`, a BullMQ event handler where an escaped exception becomes an
    // unhandled rejection that kills the whole process (it did, twice, 2026-08-31) — only
    // findOwnedDocument's own 404 is swallowed here, so a genuine write bug from the lifecycle check
    // below still throws.
    logger.info('markSendFailed: document no longer exists — nothing to mark', {
      category: 'documents',
      details: { companyId, typeId, documentId, actionId },
    });
    return;
  }
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

  // TODO_PRODUIT.md T1 / PLAN-V2 R8 — the fact is ACQUIRED right above (Postgres already holds
  // "send_failed", checked against the declared lifecycle): publishing here, never earlier, is what
  // lets a browser's own SSE connection move a screen from "sending" straight to "échec" — and shows
  // the Retry button, which the frontend derives from this exact status — without a manual reload.
  await events?.publish(companyId, { documentId, typeId, kind: 'send_failed' });

  // TODO_PRODUIT.md T2bis — `DOCUMENT_SEND_FAILED`, from the SAME acquired fact `events` just
  // announced, for the identical reason (never earlier — the idempotent/lookup-failure branches
  // above all `return` before ever reaching here). Wrapped, never left to propagate: the identical
  // "the write already genuinely happened, a dead webhook endpoint must never undo or even surface
  // past it" discipline `async-send.ts`'s own `DOCUMENT_SENT` dispatch holds.
  if (webhooks) {
    try {
      await webhooks.dispatch(
        WebhookEvent.DOCUMENT_SEND_FAILED,
        buildDocumentWebhookPayload(companyId, typeId, updated, { error: error.message }),
      );
    } catch (dispatchError) {
      logger.error('Failed to dispatch a DOCUMENT_SEND_FAILED webhook — the failure was still recorded', {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId,
          message: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        },
      });
    }
  }

  logger.warn('Document action failed after every retry — marked "send_failed"', {
    category: 'documents',
    details: { companyId, typeId, documentId, actionId, error: error.message },
  });
}

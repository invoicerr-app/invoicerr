import { logger } from '@/logger/logger.service';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { DocumentInstanceResult } from '../actions/action-registry';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentSettlement } from './compute-settlement';

/**
 * TODO_PRODUIT.md T3's own "T2bis différé": `DOCUMENT_SETTLED` fires the instant a WRITE makes a
 * document's own settlement (compute-settlement.ts) CROSS from "not settled" to "settled" — never on
 * an ordinary read/recompute of an ALREADY-settled document (a `GET .../settlement` that happens to
 * find `settled: true` fires nothing: the crossing already happened, at whichever earlier write
 * actually caused it — firing again here would turn one real event into as many webhook deliveries as
 * the screen happens to be reloaded).
 *
 * Two write paths can cause this crossing today, both checked the same way (settlement BEFORE vs.
 * settlement AFTER, straddling exactly one write):
 *  - `actions/invoice-actions.ts`'s "record-payment" — a payment inserted;
 *  - `actions/credit-note-actions.ts`'s "send" — a credit note reaching "sent" (settlement/credits.ts
 *    only counts a credit note once it is "sent", never a draft), which can settle the INVOICE it
 *    corrects even though no payment was ever recorded on it.
 * Both compute "before" by re-running `computeSettlement` with the SAME inputs minus the one row this
 * write just added (never a snapshot taken a moment earlier, which would need a second query and a
 * race window) — see each call site's own comment for exactly how it excludes "the one that just
 * changed".
 */
export function crossedIntoSettled(before: DocumentSettlement, after: DocumentSettlement): boolean {
  return !before.settled && after.settled;
}

/**
 * Dispatches `DOCUMENT_SETTLED` — the exact same "never propagate, log loudly instead" discipline
 * every other `DOCUMENT_*` dispatch in this module already holds (async-send.ts's own `DOCUMENT_SENT`
 * block is the model this is copied from): a third party's webhook endpoint being unreachable must
 * never undo, or even be visible from, the write that just made this document settled. `webhooks`
 * absent means "no capability wired for this deployment" — the same "no capability, no effect"
 * posture every other `DocumentWebhookEmitter` call site already holds, never a special case here.
 */
export async function emitDocumentSettled(
  webhooks: DocumentWebhookEmitter | undefined,
  companyId: string,
  typeId: string,
  document: DocumentInstanceResult,
  settlement: DocumentSettlement,
): Promise<void> {
  if (!webhooks) return;
  try {
    await webhooks.dispatch(
      WebhookEvent.DOCUMENT_SETTLED,
      buildDocumentWebhookPayload(companyId, typeId, document, { settlement }),
    );
  } catch (error) {
    logger.error('Failed to dispatch a DOCUMENT_SETTLED webhook — the document was still settled', {
      category: 'documents',
      details: {
        companyId,
        typeId,
        documentId: document.id,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

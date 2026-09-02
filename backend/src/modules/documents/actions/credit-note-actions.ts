import { DocumentEventPublisher } from '../queue/document-events';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

export interface CreditNoteActionDeps {
  queueDispatcher: DocumentActionQueueDispatcher;
  /** TODO_PRODUIT.md T1 / PLAN-V2 R8 — see `async-send.ts`'s own `RunAsyncSendInput.events` header. */
  events?: DocumentEventPublisher;
  /**
   * TODO_PRODUIT.md T2bis — see `async-send.ts`'s own `RunAsyncSendInput.webhooks` header. Under T2
   * this type deliberately got NO webhook at all: the schema had no `CREDIT_NOTE_SENT` (nor any other
   * `CREDIT_NOTE_*` entry) and inventing one was explicitly out of that task's scope. T2bis's own
   * generic `DOCUMENT_SENT`/`DOCUMENT_CREATED` removes the need for a per-type event entirely — this
   * type now passes the SAME `deps.webhooks` invoice/quote already do, and gets both for free.
   */
  webhooks?: DocumentWebhookEmitter;
}

/**
 * Registers the credit note type's action IMPLEMENTATIONS — "save-draft" (the exact same generic
 * mechanism the quote and the invoice already share, generic-actions.ts) and, as of item 8 of the
 * root TODO ("le lettrage"), "send" (see credit-note.descriptor.ts's own "Actions" paragraph for the
 * full reasoning). "send" is deliberately NOT the quote's own send-by-email mechanism
 * (quote-actions.ts), nor any bespoke transport lookup (the invoice's own, invoice-actions.ts): its
 * own `deliver` below does nothing at all — no transport, no email, no recipient — only the shared
 * status machinery moves the record from "draft"/"send_failed" through "sending" to "sent": this type
 * still has no "client" field, no transport, and no policy on who a credit note goes to, exactly the
 * gap this file's own history already refused to invent. What DOES need this transition to exist:
 * settlement/credits.ts only counts a credit note that is "sent" — a draft settles nothing (its own
 * comment, carried over from the removed `invoices/settlement.ts`), so lettrage needed SOME way out of
 * "draft" to mean anything at all.
 *
 * As of TODO.md item 22, this goes through `runAsyncSendAction` (actions/async-send.ts) like every
 * other type's "send" — see credit-note.descriptor.ts's own comment on why that is deliberate even
 * though this type's `deliver` has nothing to await: ONE mechanism for the action id "send", whatever
 * a given type's own delivery actually does.
 */
export function registerCreditNoteActions(registry: ActionRegistry, deps: CreditNoteActionDeps): void {
  registerSaveDraftAction(registry, 'credit-note', deps.webhooks);

  registry.register('credit-note', 'send', async ({ companyId, documentId, data, params }) =>
    runAsyncSendAction({
      companyId,
      typeId: 'credit-note',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      events: deps.events,
      // TODO_PRODUIT.md T2bis — see async-send.ts's own `RunAsyncSendInput.webhooks` header.
      webhooks: deps.webhooks,
      // credit-note.descriptor.ts declares NO `numbering` at all — never number this type, ever.
      numberOnEnqueue: false,
      // Nothing to deliver — see this file's own header. The status transition itself IS the
      // action's entire effect.
      deliver: async () => ({ message: undefined }),
    }),
  );
}

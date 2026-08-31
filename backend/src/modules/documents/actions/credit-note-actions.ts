import { upsertDocument } from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

/**
 * Registers the credit note type's action IMPLEMENTATIONS — "save-draft" (the exact same generic
 * mechanism the quote and the invoice already share, generic-actions.ts) and, as of item 8 of the
 * root TODO ("le lettrage"), "send" (see credit-note.descriptor.ts's own "Actions" paragraph for the
 * full reasoning). "send" is deliberately NOT built on generic-actions.ts's
 * `registerEmailSendAction`/`registerEmailRecipientDefaultFromClient` (the quote's own mechanism),
 * nor on any bespoke transport lookup (the invoice's own): it does not deliver anything anywhere,
 * only moves the record's own status from "draft" to "sent" — this type still has no "client" field,
 * no transport, and no policy on who a credit note goes to, exactly the gap this file's own history
 * already refused to invent. What DOES need this transition to exist: settlement/credits.ts only
 * counts a credit note that is "sent" — a draft settles nothing (its own comment, carried over from
 * the removed `invoices/settlement.ts`), so lettrage needed SOME way out of "draft" to mean anything
 * at all.
 */
export function registerCreditNoteActions(registry: ActionRegistry): void {
  registerSaveDraftAction(registry, 'credit-note');

  registry.register('credit-note', 'send', async ({ companyId, documentId, data }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen: ['draft']` (derived from SEND_TRANSITIONS,
      // credit-note.descriptor.ts) already refuses this before the handler ever runs (a never-saved
      // record has no status to match) — but a handler never trusts that alone, the same defensive
      // posture "delete" (generic-actions.ts) and the invoice's own "record-payment" already hold.
      throw new Error('Cannot send a credit note that has not been saved yet.');
    }

    return {
      document: await upsertDocument(companyId, 'credit-note', documentId, 'sent', data),
      changed: true,
    };
  });
}

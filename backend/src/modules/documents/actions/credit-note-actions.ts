import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

/**
 * Registers the credit note type's action IMPLEMENTATIONS — "save-draft" only, the exact same
 * generic mechanism the quote and the invoice already share (generic-actions.ts). Nothing else was
 * asked of this type ("au minimum enregistrer le brouillon" — see credit-note.descriptor.ts's header
 * comment), so nothing else is registered here: no "send", no status-changing action, since either
 * one would mean inventing a policy (who receives a credit note? through which channel?) that was
 * never part of this task.
 */
export function registerCreditNoteActions(registry: ActionRegistry): void {
  registerSaveDraftAction(registry, 'credit-note');
}

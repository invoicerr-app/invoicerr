import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { ActionRegistry } from './action-registry';
import { registerDeleteAction, registerSaveDraftAction } from './generic-actions';

/**
 * Registers the expense type's action IMPLEMENTATIONS — both generic, both shared with other
 * document types already: "save-draft" (every type here has it) and "delete" (registerDeleteAction's
 * own comment explains why the expense is its first, deliberately narrow, user).
 *
 * `webhooks` (TODO_PRODUIT.md T2bis) — same optional posture as every other type's own deps: an
 * expense gets `DOCUMENT_CREATED`/`DOCUMENT_DELETED` for free through the exact same generic
 * mechanism, no expense-specific wiring needed.
 */
export function registerExpenseActions(registry: ActionRegistry, webhooks?: DocumentWebhookEmitter): void {
  registerSaveDraftAction(registry, 'expense', webhooks);
  registerDeleteAction(registry, 'expense', webhooks);
}

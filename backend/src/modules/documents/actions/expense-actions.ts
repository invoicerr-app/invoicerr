import { ActionRegistry } from './action-registry';
import { registerDeleteAction, registerSaveDraftAction } from './generic-actions';

/**
 * Registers the expense type's action IMPLEMENTATIONS — both generic, both shared with other
 * document types already: "save-draft" (every type here has it) and "delete" (registerDeleteAction's
 * own comment explains why the expense is its first, deliberately narrow, user).
 */
export function registerExpenseActions(registry: ActionRegistry): void {
  registerSaveDraftAction(registry, 'expense');
  registerDeleteAction(registry, 'expense');
}

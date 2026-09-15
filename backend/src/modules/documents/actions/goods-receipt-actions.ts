import { updateDocumentStatus } from '../persistence';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { ActionRegistry } from './action-registry';
import { registerDeleteAction, registerSaveDraftAction } from './generic-actions';

/**
 * Registers the "goods-receipt" type's action IMPLEMENTATIONS — see goods-receipt.descriptor.ts's own
 * header for the full "why" behind every choice below. "save-draft" and "delete" are the exact same
 * generic mechanisms every other type here reuses (generic-actions.ts); "record" is the one bespoke
 * handler, a plain STATUS-ONLY write mirroring `received-invoice-actions.ts`'s own "approve"/"reject"
 * in every respect, webhook included: neither of those dispatches one either (only "receive"/"delete"
 * do, via the generic paths) — a plain terminal status flip with no new data, and no per-type webhook
 * this codebase's own event vocabulary (`WebhookEvent`, schema.prisma) has a fact-accurate member for
 * ("DOCUMENT_SENT" would misname a receipt that is never sent anywhere — see the descriptor's own
 * header), gets none here either, the same restraint `received-invoice-actions.ts` already shows.
 */
export function registerGoodsReceiptActions(
  registry: ActionRegistry,
  webhooks?: DocumentWebhookEmitter,
): void {
  registerSaveDraftAction(registry, 'goods-receipt', webhooks);

  registry.register('goods-receipt', 'record', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen: ['draft']` already refuses this before the handler
      // runs (a never-saved record has no status to match) — but a handler never trusts that alone,
      // the same defensive posture every other action in this module already holds.
      throw new Error('Cannot record a goods receipt that has not been saved yet.');
    }

    return {
      document: await updateDocumentStatus(companyId, 'goods-receipt', documentId, 'recorded'),
      changed: true,
      message: 'Recorded.',
    };
  });

  // See the descriptor's own header on why this is restricted to "draft" only.
  registerDeleteAction(registry, 'goods-receipt', webhooks);
}

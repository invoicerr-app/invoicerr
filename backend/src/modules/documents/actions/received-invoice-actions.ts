import { updateDocumentStatus, upsertDocument } from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerDeleteAction } from './generic-actions';

/**
 * Registers the "received-invoice" type's action IMPLEMENTATIONS — root TODO item 18. Three bespoke
 * handlers plus one reused generic one, none of them touching a transport, a queue, or an email —
 * this type is never sent anywhere (see received-invoice.descriptor.ts's own header).
 */
export function registerReceivedInvoiceActions(registry: ActionRegistry): void {
  /**
   * "receive": this type's create/edit action — the same role `registerSaveDraftAction`
   * (generic-actions.ts) plays for every other type, NOT reused verbatim because that helper
   * hardcodes the status "draft" (see its own header) — this type has no "draft" status at all (see
   * the descriptor's own header on why "received" is the initial status). Persists whatever `data`
   * the caller sent, including the `fileRef`/`fileName`/`fileMime` keys the upload flow
   * (received-invoices/received-invoices.service.ts) and the frontend's own upload dialog seed into
   * it — those three keys are not declared `DocumentFieldDescriptor`s (see the descriptor's own
   * header on why), so `validateAgainstDescriptor` never touches them, but `upsertDocument` persists
   * `data` whole, exactly the same way it already does for every other type's own declared fields.
   */
  registry.register('received-invoice', 'receive', async ({ companyId, documentId, data }) => ({
    document: await upsertDocument(companyId, 'received-invoice', documentId, 'received', data),
    changed: true,
  }));

  /**
   * "approve"/"reject": plain, terminal status transitions — no data effect, mirroring
   * credit-note-actions.ts's own "send" in spirit (a status change and nothing else) but even
   * simpler: not even asynchronous (there is nothing to deliver, ever, for this type), so this reuses
   * `updateDocumentStatus` (persistence.ts) directly rather than `runAsyncSendAction`. Both are only
   * ever reachable once a record already exists (`availableWhen: ['received']` on the descriptor), so
   * `documentId` is always defined here — the guard below is the same defensive posture
   * `generic-actions.ts`'s own `registerDeleteAction` documents for the identical, structurally
   * unreachable case.
   */
  registry.register('received-invoice', 'approve', async ({ companyId, documentId }) => {
    if (!documentId) {
      throw new Error('Cannot approve a "received-invoice" document that has not been saved yet.');
    }
    return {
      document: await updateDocumentStatus(companyId, 'received-invoice', documentId, 'approved'),
      changed: true,
      message: 'Approved.',
    };
  });

  registry.register('received-invoice', 'reject', async ({ companyId, documentId }) => {
    if (!documentId) {
      throw new Error('Cannot reject a "received-invoice" document that has not been saved yet.');
    }
    return {
      document: await updateDocumentStatus(companyId, 'received-invoice', documentId, 'rejected'),
      changed: true,
      message: 'Rejected.',
    };
  });

  // See the descriptor's own header on why this is restricted to "received" only — the same
  // mechanism `expense-actions.ts` already registers, applied to a narrower `availableWhen`.
  registerDeleteAction(registry, 'received-invoice');
}

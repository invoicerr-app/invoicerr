import { updateDocumentStatus, upsertDocument } from '../persistence';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { checkReceivedInvoiceLineTotals } from '../received-invoices/line-totals-check';
import { markClientAsSupplier } from '../received-invoices/supplier-reconciliation';
import { ActionRegistry } from './action-registry';
import { registerDeleteAction } from './generic-actions';

/**
 * Registers the "received-invoice" type's action IMPLEMENTATIONS — root TODO item 18. Three bespoke
 * handlers plus one reused generic one, none of them touching a transport, a queue, or an email —
 * this type is never sent anywhere (see received-invoice.descriptor.ts's own header).
 *
 * `webhooks` (TODO_PRODUIT.md T2bis) only reaches the generic "delete" below — "receive" (this
 * type's OWN create/edit action, not `registerSaveDraftAction`) deliberately does NOT dispatch
 * `DOCUMENT_CREATED` here: `DOCUMENT_RECEIVED` (TODO_PRODUIT.md's own T5) is the honest event for an
 * inbound deposit, and wiring `DOCUMENT_CREATED` here too, ahead of that decision, would give a
 * receiver two different "this arrived" signals for the same fact.
 */
export function registerReceivedInvoiceActions(
  registry: ActionRegistry,
  webhooks?: DocumentWebhookEmitter,
): void {
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
   *
   * TODO_PRODUIT.md T5(a) — also computes `lineTotalWarnings` (received-invoices/line-totals-check.ts)
   * and writes it into `data` under that same reserved-key convention: an array, possibly empty, of
   * NAMED warnings when the lines' own sum disagrees with the flat `netAmount`/`vatAmount`/
   * `grossAmount` beyond rounding tolerance. Recomputed on EVERY save (this action is the type's only
   * create/edit path), so editing a line — or the stated totals — always leaves the persisted warning
   * in sync with what was just saved; STORED, not recomputed on every read, which is what makes the
   * warning "porté par le document" (visible again on a later GET, the list, the detail screen)
   * without a second generic mechanism reading `lines` on every fetch.
   *
   * TODO_PRODUIT.md T5(b) — also the ONLY point that turns a supplier LINK into a persisted role:
   * when `data.supplierClient` (the 'reference' field, entity "supplier" — see the descriptor's own
   * header) names a client, that Client is marked `isSupplier: true`
   * (`received-invoices/supplier-reconciliation.ts#markClientAsSupplier`) — whether the link came from
   * upload-time auto-reconciliation (`received-invoices.service.ts#upload`, pre-filling this very
   * field) or from the user picking one by hand: both converge on this ONE handler, so both mark the
   * role the same way. Never called when the field is empty — a received invoice with no linked
   * supplier touches no Client at all.
   */
  registry.register('received-invoice', 'receive', async ({ companyId, documentId, data }) => {
    const lineTotalWarnings = checkReceivedInvoiceLineTotals(data);
    const dataWithWarnings = { ...data, lineTotalWarnings };
    const document = await upsertDocument(
      companyId,
      'received-invoice',
      documentId,
      'received',
      dataWithWarnings,
    );

    const supplierClientId = typeof data.supplierClient === 'string' ? data.supplierClient : undefined;
    if (supplierClientId) {
      await markClientAsSupplier(companyId, supplierClientId);
    }

    return { document, changed: true };
  });

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
  registerDeleteAction(registry, 'received-invoice', webhooks);
}

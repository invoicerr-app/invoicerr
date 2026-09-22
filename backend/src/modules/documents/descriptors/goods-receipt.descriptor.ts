import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/**
 * Purchase orders & goods receipts, second pass (three-way match) — the
 * SEVENTH type, written the same way every type since the third (credit-note) has been: entirely as
 * data, on the model of
 * `purchase-order.descriptor.ts` (its own closest sibling — see that file's own header for the full
 * "why data, not code" account this header does not repeat).
 *
 * A GOODS RECEIPT records what this company's own warehouse actually received
 * against a purchase order it placed — the middle leg of the 3-way match (PO × receipt × received
 * invoice, `reconciliation/three-way-match.ts`). Structurally the mirror image of `received-invoice.
 * descriptor.ts`: this company is the one WRITING the record (unlike a received invoice, nothing here
 * is extracted from a THIRD PARTY's own document), but, like a received invoice, it is never sent
 * anywhere, never signed, and never numbered by anyone but this company itself — a purely INTERNAL
 * bookkeeping fact, never a fiscal document a tax authority or a counterparty ever sees.
 *
 * ## `purchaseOrder` — required, the ONE thing that makes this a "receipt" rather than a stray note
 *
 * A goods receipt with no purchase order to reconcile against is not a partial record the way a
 * received invoice's own near-empty fields are (see that descriptor's own header) — it is a
 * CATEGORY ERROR: the entire reason this type exists is the 3-way match, and a receipt floating free
 * of any PO has nothing for that match to anchor on. `required: true`, unlike almost every field on
 * `received-invoice.descriptor.ts`. Reuses the "supplier" 'reference' entity's own sibling mechanism —
 * `entity: 'purchase-order'` is registered in `documents-core.module.ts#buildEntityReferenceRegistry`
 * via `buildDocumentReferenceProvider('purchase-order', ...)`, the exact same factory that already
 * backs the invoice's own "origin" (quote/invoice) and the credit note's own "invoice" fields — no new
 * provider shape, just one more call.
 *
 * ## `lines` — free-text description + received quantity ONLY, matched to the PO by description
 *
 * Deliberately NOT a `rowSelection` field pointed at the PO's own `lines` (row-selection/
 * row-selection.ts's own 10th kind, the credit note's own `correctedLines`): that kind's stored value
 * is `string[]` — a POINTER to which SOURCE rows were picked — with no room for a per-row value this
 * type MUST carry (`quantityReceived`, which usually differs from what was ordered — a partial
 * delivery is the routine case, not the exception). Carrying an editable overlay value keyed to a
 * `rowSelection`'s own picked ids would need a SECOND array threaded through by row identity, a shape
 * no other type in this core needs yet and this pass has no mandate to build. Matching by DESCRIPTION
 * instead — the exact same pragmatic, documented choice `reconciliation/three-way-match.ts`'s own
 * header defends at length — keeps this descriptor exactly as simple as `purchase-order.descriptor.
 * ts`'s own `lines` (free-text `description` + one number), and lets the reconciliation ENGINE do the
 * cross-document matching entirely on its own, from plain data, exactly like `tax/tax-engine.ts`
 * already does for a different concern.
 *
 * The frontend PRE-FILLS a brand-new receipt's `lines` from the chosen PO's own `lines` (each row's
 * `quantity` seeded as the STARTING `quantityReceived`, immediately editable) the moment `purchaseOrder`
 * resolves — a screen convenience (`document-form.tsx`'s own narrow, named exception, see that file's
 * comment) built on the EXISTING generic `GET /documents/references/:entity/:refId/fields` endpoint
 * (`document-reference.provider.ts#getFields`, already returns a purchase order's `data` verbatim,
 * `lines` included) — no new backend surface for this.
 *
 * ## Lifecycle: `draft -> recorded`, the SIMPLEST two-status shape in this core
 *
 * `draft` is genuinely editable (re-run "save-draft" as many times as needed while entering what
 * arrived); "record" is a PLAIN, terminal, ONE-WAY status flip — no data rewrite of its own (the data
 * was already persisted by whichever "save-draft" call preceded it, the exact same split invoice.
 * descriptor.ts's own "save-draft" -> "send" already holds) — once a receipt is `recorded` it is part
 * of the reconciliation trail the "Reconciliation" panel reads, and editing it further would silently
 * rewrite history a received invoice may already have been checked against. No "cancel": nothing in
 * this pass's own product decision asks for one, and inventing a correction mechanism for an internal
 * bookkeeping record is exactly the kind of unrequested machinery this codebase avoids — a mistaken
 * receipt is a "delete" (below), same posture `received-invoice.descriptor.ts`'s own "delete" holds
 * for the identical "record recorded in error, before any review depends on it" case.
 *
 * Numbers at "recorded" (`numbering.onEnterStatus`), the same "assigned once it becomes a real fact,
 * never at draft" convention every numbered type here already holds — `numbering/format-number.ts`'s
 * own `defaultNumberFormatFor` derives "GOODS-RECEIPT-{year}-{number:4}" straight from
 * `typeId.toUpperCase()`, so the shipped default prefix ("GOODS-RECEIPT-") needs no bespoke code here,
 * exactly like `purchase-order.descriptor.ts`'s own header documents for "PURCHASE-ORDER-".
 *
 * `delete` is restricted to `draft` only — the exact same "reviewed record must not silently vanish"
 * reasoning `received-invoice.descriptor.ts`'s own header gives for its own `delete`.
 *
 * ## What this type deliberately does NOT declare
 *
 *  - `email`/`usesLegalMentions`/`usesPaymentQr`/`usesPaymentMethods`: never sent, never a tax
 *    document, never requests payment — the identical reasoning `received-invoice.descriptor.ts`'s own
 *    header gives for the same absences on its own, structurally similar type.
 *  - `contributions`: no dashboard/statistics widget was asked for in this pass.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const RECORD_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'recorded' }];

export function buildGoodsReceiptDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'goods-receipt',
    label: 'Goods receipt',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'recorded', label: 'Recorded' },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'recorded' },
    listItem: {
      titleFields: ['purchaseOrder'],
      secondaryFields: ['receiptDate'],
    },
    fields: [
      {
        key: 'purchaseOrder',
        kind: 'reference',
        label: 'Purchase order',
        required: true,
        entity: 'purchase-order',
        helpText: "The purchase order this delivery fulfills — required, see this type's own header.",
      },
      {
        key: 'receiptDate',
        kind: 'date',
        label: 'Receipt date',
        required: true,
      },
      {
        key: 'notes',
        kind: 'longText',
        label: 'Notes',
        required: false,
      },
      {
        key: 'lines',
        kind: 'array',
        label: 'Lines',
        required: true,
        min: 1,
        // No `prefillFrom` (that hint is for a PER-ROW catalog pick, e.g. an article — see types.ts's
        // own comment); the WHOLE-ARRAY prefill from the chosen PO's own lines is a frontend screen
        // convenience instead — see this descriptor's own header.
        fields: [
          {
            key: 'description',
            kind: 'text',
            label: 'Designation',
            required: true,
          },
          {
            key: 'quantityReceived',
            kind: 'number',
            label: 'Quantity received',
            required: true,
            min: 0,
          },
        ],
      },
    ],
    actions: [
      {
        id: 'save-draft',
        label: 'Save draft',
        transitions: SAVE_DRAFT_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SAVE_DRAFT_TRANSITIONS),
      },
      {
        id: 'record',
        label: 'Record',
        transitions: RECORD_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(RECORD_TRANSITIONS),
        // No params — a plain, terminal status flip; the data was already saved by "save-draft" (see
        // this descriptor's own header).
      },
      {
        id: 'delete',
        label: 'Delete',
        // Not 'always' (a never-saved record has no documentId to act on — generic-actions.ts's own
        // registerDeleteAction) and not ['draft', 'recorded'] either — see this descriptor's own header
        // on why deletion stops being offered once a receipt is recorded.
        availableWhen: ['draft'],
      },
    ],
  };
}

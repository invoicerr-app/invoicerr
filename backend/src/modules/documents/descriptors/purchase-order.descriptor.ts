import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { standardDocumentEmailTranslations } from './standard-email-translations';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as every other document type's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * Purchase orders & goods receipts ("bons de commande / achats fournisseurs") — the SIXTH type written
 * entirely as data, on the model of quote.descriptor.ts (the closest sibling: a document this company
 * ISSUES to a single counterparty, sent by email, with no compliance/tax engine involvement). This is
 * the FIRST PASS only: EMITTING a purchase order. The second pass — reconciling a received invoice
 * against the purchase order it fulfills (3-way match: quantity/amount/PO) — is deliberately NOT built
 * here; it needs its own product decisions this pass does not make (which discrepancies to tolerate,
 * who validates a mismatch, what happens to one) — see this feature's own report for what that would
 * require. `received-invoices/supplier-reconciliation.ts` already reconciles a received invoice
 * against a KNOWN SUPPLIER; matching it against a specific PURCHASE ORDER on top of that is a
 * different, additive mechanism, not something this descriptor needs to anticipate structurally.
 *
 * ## The addressee — "supplier" (`Client.isSupplier`), never a new model
 *
 * `Client` is the only third-party model this codebase has — see `received-invoice.descriptor.ts`'s
 * own header on `supplierClient` for the full "why a role flag, never a dedicated entity" reasoning
 * (`Client.isSupplier`'s own schema comment). A purchase order reuses the EXACT SAME "supplier" entity
 * id already registered in `documents-core.module.ts#buildEntityReferenceRegistry`
 * (`buildClientReferenceProvider(clientsService)`, no `excludeSuppliers` — any client can become a
 * supplier, and one already flagged must stay findable) — nothing new to wire. This is a CHOICE TO
 * VALIDATE with the product owner, not a researched fact: a purchase order addressed to a `Client`
 * flagged (or flaggable) `isSupplier` is the simplest fit onto the existing model, but nothing stops a
 * future pass from wanting a narrower "vendor" concept of its own if suppliers turn out to need fields
 * a generic Client has no room for.
 *
 * Deliberately `entity: 'supplier'`, NOT `entity: 'client'` (the invoice's/quote's own BILLABLE
 * picker, which EXCLUDES pure suppliers from its search — see `client-reference.provider.ts`'s own
 * header): a company's stationery supplier, never invoiced back, must still show up in THIS picker.
 * `findClientReferenceField` (actions/email-template.ts) was widened to recognize BOTH entities as
 * "the recipient this type addresses" so `{recipientName}` in the email template, and the recipient-
 * language resolution (`rendering/render-instance-pdf.ts`), work for this type exactly the way they
 * already do for the quote/invoice's own "client" — one rule, now two entities, never a per-type branch.
 *
 * ## The lines — deliberately NO catalog "from article" prefill, and NO stock effect
 *
 * The quote's/invoice's own `lines` declare `prefillFrom: { entity: 'article', ... }` plus an
 * `articleId` (kind 'hiddenReference') so a row can be filled from the Article catalog. This
 * descriptor deliberately declares NEITHER: `stock/apply-stock-on-issuance.ts` is wired GENERICALLY,
 * type-blind by design ("never named 'invoice' anywhere in this file... any current or future
 * article-referencing document type gets the exact same bookkeeping for free") into BOTH numbering
 * sites a "send" can reach (`documents.service.ts#runAction`'s own post-handler hook, and
 * `actions/async-send.ts`'s own "numberOnEnqueue" path) — it DECREMENTS stock the moment a document
 * carrying an `articleId`-tagged line is numbered. That is exactly backwards for a purchase order: we
 * are the BUYER here, and sending a PO to a supplier should, if anything, eventually INCREASE stock
 * once the goods are actually received — never decrease it the moment the order is merely placed.
 * Wiring the catalog picker without also building the (separate, second-pass) "receiving" half that
 * would credit stock back would silently make placing an order for articles this company still has
 * plenty of read as an oversell. Lines here carry only a free-text `description`, `quantity`, and
 * `unitPrice` — no article link, no stock consequence, ever, from this type alone.
 *
 * No `vatRate` either — a purchase order is not a tax document (nothing here composes with
 * `tax/tax-engine.ts`, and none of `usesLegalMentions`/`usesPaymentQr`/`usesPaymentMethods` apply, for
 * the identical reasoning `received-invoice.descriptor.ts`'s own header gives for why THOSE flags are
 * an issuance concern this inbound-shaped type has no business opting into — a PO is, in that sense,
 * the OUTBOUND mirror of a received invoice: this company's own commitment to buy, not a request to be
 * paid, and not something any tax authority reads). `totals/compute-totals.ts`'s own `extractVatRate`
 * was fixed (see that file's own header) to stay SILENT — no "no usable VAT rate" warning per line —
 * for exactly this shape: a line-array type that declares no VAT-like `select` subfield AT ALL, as
 * opposed to one that declares one but leaves a particular row's value unset. Net and gross are
 * therefore always equal for a purchase order's own totals, which is the honest fact: it states no tax.
 *
 * ## Numbering — the shipped DEFAULT prefix is "PURCHASE-ORDER-", not "PO-"
 *
 * `numbering/format-number.ts#defaultNumberFormatFor` derives the shipped default straight from
 * `typeId.toUpperCase()` — there is no per-type "declare your own default prefix" hook anywhere in
 * that module (every other type's own default already IS its own id, uppercased: "QUOTE-", "INVOICE-",
 * "CREDIT-NOTE-"), and inventing one for a SINGLE new consumer would be exactly the kind of
 * speculative, single-consumer machinery this codebase avoids. So `purchase-order` numbers as
 * "PURCHASE-ORDER-{year}-{number:4}" out of the box, not the shorter "PO-" a first read of this
 * feature's own spec might suggest — CHOICE TO VALIDATE: a company that wants "PO-" can already set
 * one via `Company.numberFormats["purchase-order"]` (the same generic per-type override every type
 * already supports at the API level), but there is no SETTINGS SCREEN control for it yet — the
 * existing screen (`company.settings.tsx`) only exposes `quote`/`invoice`'s own formats, exactly like
 * `credit-note`/`expense`/`received-invoice` already have no UI for theirs either.
 *
 * ## Lifecycle — the quote's own shape, plus "cancel" (mirroring the invoice's), under one rename
 *
 * `draft -> sending -> sent | send_failed`, the exact two-phase async-send shape every "send"-capable
 * type here shares (`actions/async-send.ts`), PLUS a terminal `cancelled` — the invoice's own shape
 * (invoice.descriptor.ts), not the quote's: a purchase order sent to a supplier can need to be called
 * off (the order is no longer wanted, a mistake was made) the same honest way an issued invoice
 * sometimes needs cancelling, and the request for this pass names "cancel" as a required action.
 *
 * DELIBERATELY NOT declared under the action id "cancel": BOTH `document-form.tsx` and
 * `document-list.tsx` (frontend) unconditionally filter OUT any action literally named `"cancel"` from
 * their generic action-button row — `action.id !== "cancel"` — on the theory (their own comment) that
 * "its ONE entry point is the correction-routes dialog" (`custom/invoice-correction-routes-button.tsx`,
 * the invoice's own, country-correction-routes-driven cancellation UI). That reasoning does not apply
 * here at all: a purchase-order cancellation is a PLAIN business decision ("we no longer need this
 * order"), never a legal correction route (no `correction-routes/` data names this type, and none
 * should — CANCEL_AND_REPLACE is about correcting an ALREADY-TRANSMITTED FISCAL document, which a PO
 * structurally is not). Naming this action "cancel" would make it silently UNREACHABLE from the
 * screen (no button anywhere, since no custom "list-row-extra"/dialog is registered for this type
 * either) — exactly the kind of mechanism-bypassing surprise this codebase's own discipline warns
 * against. The id is `"cancel-order"` instead (label still "Cancel", a purely cosmetic difference
 * from the invoice's own) so it flows through the ordinary, generic action-button row like
 * "save-draft"/"send", or like received-invoice's own "approve"/"reject" — no bespoke frontend code.
 *
 * `record-payment`/`export-accounting`/`download-xml`/`share-link`/`usesLegalMentions`/`usesPaymentQr`/
 * `usesPaymentMethods`/`contributions` are ALL deliberately absent: none of them describe anything a
 * purchase order does — it never gets paid (it isn't an invoice), it never carries statutory mentions
 * or a payment QR (it doesn't request money), it has no normalized-format export today, and no
 * dashboard/statistics widget was asked for in this pass.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];
const CANCEL_ORDER_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['sent', 'send_failed'], to: 'cancelled' },
];

export function buildPurchaseOrderDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'purchase-order',
    label: 'Purchase order',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      { id: 'sent', label: 'Sent' },
      { id: 'send_failed', label: 'Send failed' },
      { id: 'cancelled', label: 'Cancelled' },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'sending' },
    // See types.ts's own comment on `DocumentTypeDescriptor.email`, and quote.descriptor.ts for the
    // same call on the sibling type — sober, plain-English default, overridable per company.
    // `{recipientName}` resolves from `supplier` below via the widened `findClientReferenceField`
    // (actions/email-template.ts) — see this file's own header.
    email: {
      subject: '{typeLabel} {displayNumber} from {companyName}',
      body:
        'Dear {recipientName},\n\n' +
        'Please find attached {typeLabel} {displayNumber} from {companyName}, for a total of ' +
        '{totalGross}.\n\n' +
        'Best regards,\n{companyName}',
    },
    emailTranslations: standardDocumentEmailTranslations(),
    // See types.ts's own comment on `listItem`. `supplier` is the one thing a reader scans a list of
    // purchase orders for — the same role `client` plays for the quote/invoice.
    listItem: {
      titleFields: ['supplier'],
      secondaryFields: ['issueDate', 'expectedDeliveryDate', 'currency', 'reference'],
    },
    fields: [
      {
        key: 'supplier',
        kind: 'reference',
        label: 'Supplier',
        required: true,
        entity: 'supplier',
      },
      {
        key: 'issueDate',
        kind: 'date',
        label: 'Date',
        required: true,
      },
      {
        key: 'expectedDeliveryDate',
        kind: 'date',
        label: 'Expected delivery date',
        required: false,
      },
      {
        key: 'currency',
        kind: 'select',
        label: 'Currency',
        required: true,
        options: CURRENCY_OPTIONS,
      },
      // This company's OWN internal reference for the order (a project code, a cost-centre note) —
      // the mirror image of the quote's/invoice's own `clientReference` (the BUYER's reference,
      // printed for THEM): here WE are the buyer, so this is our own note, never a legal fact, and
      // `hideWhenEmpty` for the identical reason `clientReference` carries it — an unset convenience
      // reference has nothing to communicate (see quote.descriptor.ts's own comment on that field).
      {
        key: 'reference',
        kind: 'text',
        label: 'Reference',
        required: false,
        helpText: "This company's own internal reference for this order.",
        hideWhenEmpty: true,
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
        // No `prefillFrom`, no `articleId`, no `vatRate` — see this file's own header ("The lines —
        // deliberately NO catalog prefill, and NO stock effect").
        fields: [
          {
            key: 'description',
            kind: 'text',
            label: 'Designation',
            required: true,
          },
          {
            key: 'quantity',
            kind: 'number',
            label: 'Quantity',
            required: true,
            min: 0,
          },
          {
            key: 'unitPrice',
            kind: 'money',
            label: 'Unit price',
            required: true,
            min: 0,
            currencyField: 'currency',
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
        id: 'send',
        label: 'Send',
        transitions: SEND_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SEND_TRANSITIONS),
        // Reuses the exact same field vocabulary as the document's own `fields` above, the same
        // convention quote.descriptor.ts's own "send" already holds. `recipient` is pre-filled from
        // the supplier's own contact email when one is set (see actions/purchase-order-actions.ts's
        // own `registerEmailRecipientDefaultFromClient(..., 'supplier')` call), but the user can still
        // send elsewhere.
        params: [
          {
            key: 'recipient',
            kind: 'text',
            label: 'Recipient email',
            required: true,
          },
        ],
      },
      {
        id: 'cancel-order',
        label: 'Cancel',
        transitions: CANCEL_ORDER_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(CANCEL_ORDER_TRANSITIONS),
        // No params — a plain, irreversible status flip, exactly like the invoice's own "cancel"
        // (invoice-actions.ts) — see this file's own header for why the id itself is NOT "cancel".
      },
    ],
  };
}

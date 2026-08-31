import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as every other document type's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The RECEIVED INVOICE document type — root TODO item 18 ("réception de factures"), the D — L'entrée
 * category's first (and, for this wave, only) type. Unlike every OUTBOUND type this core has
 * (quote/invoice/credit-note), this one is never numbered by US, never sent, and never signed: it
 * records a fact about something a THIRD PARTY (a supplier) already issued, which this company is
 * merely bookkeeping.
 *
 * ## Fields — why these, and why so little is `required`
 *
 *  - `supplier` (text, NOT a `reference` to the "client" entity): a supplier is not a client. This
 *    core's `client-reference.provider.ts` resolves entries in `Company`'s own client book, which
 *    has nothing to do with who sold something TO this company. A future "supplier" address book is
 *    plausible but is not asked for here — see this task's own item 18 scope note below.
 *  - `supplierNumber`: the invoice number is the SUPPLIER'S OWN — this type deliberately declares no
 *    `numbering` (see that field's own comment below): assigning OUR sequence to somebody else's
 *    invoice would be a fabricated identifier, not a recorded fact.
 *  - `issueDate`, `dueDate` (dueDate optional): dueDate is genuinely often unextractable — this
 *    core's OWN outbound CII/UBL builders never emit BT-9 either (see
 *    `formats/semantic/build-semantic-invoice.ts`'s own header: "OMITTED, no `dueDate` is threaded
 *    through"), so a real received invoice from another EN 16931 sender may carry no due date at
 *    all in its structured data even when extraction otherwise succeeds.
 *  - `currency`, `netAmount`, `vatAmount`, `grossAmount`: FLAT money fields, deliberately NOT an
 *    'array' of detailed lines the way the invoice's own `lines` field is. A received invoice is
 *    being RECORDED, not re-priced or re-computed by this company — the totals are whatever the
 *    supplier's own document says, taken (extracted or typed) as-is. Line-by-line detail would add a
 *    whole re-entry burden for a bookkeeping fact this task does not ask this core to reconstruct;
 *    consigned explicitly as future scope, not silently dropped (see this file's own tail comment).
 *
 * Every one of the eight fields above is `required: false` — DELIBERATELY, unlike every outbound
 * type here (an invoice needs a client, a credit note needs the invoice it corrects). The task this
 * type exists for is explicit: "recevoir un PDF papier scanné est le cas de base d'un artisan" — a
 * plain scanned PDF carries NO machine-extractable field at all, and the whole point of this type is
 * that such a document still gets recorded, with an attached file and empty fields to fill in later,
 * rather than being refused. Making any field required here would turn that base case into a wall.
 * The one thing this type always insists on is the FILE itself — see `fileRef`'s own note below.
 *
 * ## The file — `data` JSON, not a new column, not a declared `DocumentFieldDescriptor`
 *
 * `fileRef` (the uploaded file's own SHA-256, content-addressed — see
 * `received-invoices/storage.ts`), `fileName`, and `fileMime` are written straight into this
 * instance's `data` JSON by the upload flow (`received-invoices/received-invoices.service.ts`) and
 * by the "receive" action handler below, exactly the way `DocumentInstance.data` already carries
 * every other field's value — no migration needed (`DocumentInstance.data` already is a `Json`
 * column; see this task's own instruction to prefer it over a new column). They are NOT listed in
 * `fields` above on purpose: a raw SHA-256 hex string is not something a human ever TYPES or EDITS
 * through the generic field-kind form (there is no 'file' field kind in this core, and inventing one
 * for this single use would be exactly the kind of speculative, single-consumer vocabulary this
 * codebase avoids — see `field-kinds.ts`'s own closed `CORE_FIELD_KINDS`). Downloading the original
 * file is instead a dedicated custom-slot button (frontend `custom/received-invoice-download-button.
 * tsx`, registered at the existing "list-row-extra" slot — the exact mechanism
 * `custom/invoice-preview-button.tsx` already established) and a dedicated backend route
 * (`GET /documents/received-invoices/:id/file`), never a generic field render.
 *
 * ## Lifecycle: `received` -> `approved` | `rejected`, no `draft`
 *
 * Every OTHER type here starts at "draft" because there is a genuine half-finished, not-yet-real
 * state before a quote/invoice/credit-note exists at all. A received invoice has no such state: the
 * fact that "this company received a document" is already true the moment it is recorded, whether
 * every field is filled in or not (see the fields note above) — so this type's own INITIAL status is
 * "received" itself, never a separate "draft" nobody would ever transition out of on purpose. The
 * "receive" action (received-invoice-actions.ts) is this type's create/edit action — the same role
 * `registerSaveDraftAction` plays for every other type, renamed because it does not write "draft".
 * Declared `from: 'always'` (covers both "brand new, no status yet" and "editing an existing
 * received-invoice's fields") the same way `expense.descriptor.ts`'s own "save-draft" is — country
 * policy is what actually narrows re-editing to the "received" status only (see country-policy's
 * `data/fr.json`/`data/us.json`), the same composition `invoice.descriptor.ts`'s "save-draft" already
 * relies on for its own, stricter, "draft" narrowing.
 *
 * "approve"/"reject": plain, terminal status transitions, `['received'] -> 'approved'` /
 * `['received'] -> 'rejected'` — no data effect, no transport, no email (see below). Both are
 * deliberately ONE-WAY: neither this descriptor nor its actions declare any transition back out of
 * "approved"/"rejected" — an approval or a rejection is meant to be a real, final review decision.
 *
 * "delete": the generic `registerDeleteAction` (actions/generic-actions.ts), restricted to
 * `availableWhen: ['received']` ONLY — deliberately NOT available once "approved" or "rejected". The
 * expense's own "delete" is unrestricted (an expense has one status, ever) because it is pure
 * internal bookkeeping housekeeping; a received invoice that has already been formally approved or
 * rejected is closer to a reviewed record than a mis-entered draft, and letting it vanish silently
 * after that review would erase the very decision this lifecycle exists to keep. A mis-uploaded
 * document (wrong file, duplicate entry corrected some other way) can still be deleted BEFORE that
 * review concludes, which is the actual "oops" case this task asks to cover.
 *
 * ## What this type deliberately does NOT declare
 *
 *  - `numbering`: see `supplierNumber`'s own note above — this type is never numbered by us.
 *  - `email`: every other shipped type declares a default even where it never sends (credit-note,
 *    expense), reasoning that a company overriding `documentEmailTemplates` ahead of one existing
 *    gets a sober default rather than a hole. That reasoning does not carry over here: this type has
 *    no "send" action AND STRUCTURALLY NEVER WILL (see this file's own header — recording a document
 *    someone else issued has no "deliver it" step at all, unlike a credit note's minimal, no-op
 *    "send" which still exists to satisfy lettrage). `actions/email-template.ts`'s own
 *    `GENERIC_FALLBACK_EMAIL_TEMPLATE` is not a gap for a type that can never reach the code path
 *    that would read it.
 *  - `usesLegalMentions`: BG-1 statutory mentions are an ISSUANCE concept (this company's own
 *    outbound invoice) — irrelevant to a document this company only receives and records.
 */
const RECEIVE_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'received' }];
const APPROVE_TRANSITIONS: DocumentActionTransition[] = [{ from: ['received'], to: 'approved' }];
const REJECT_TRANSITIONS: DocumentActionTransition[] = [{ from: ['received'], to: 'rejected' }];

export function buildReceivedInvoiceDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'received-invoice',
    label: 'Received invoice',
    statuses: [
      { id: 'received', label: 'Received' },
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ],
    initialStatus: 'received',
    // Dashboard only — see contributions/received-invoice-contributions.ts's own header for why
    // there is no 'statistics' entry in this first wave (not asked for by root TODO item 18).
    contributions: ['dashboard'],
    // See types.ts's own comment on `listItem`. `supplier` is the natural heading for "who is this
    // from" — `supplierNumber` joins it (both required: false, so the fallback "<label> #<id>" title
    // still applies honestly on a freshly-recorded plain-PDF record with neither filled in yet).
    listItem: {
      titleFields: ['supplier', 'supplierNumber'],
      secondaryFields: ['issueDate', 'grossAmount'],
    },
    fields: [
      {
        key: 'supplier',
        kind: 'text',
        label: 'Supplier',
        required: false,
        helpText: "The supplier's name — free text, not a reference to this company's own client book.",
      },
      {
        key: 'supplierNumber',
        kind: 'text',
        label: "Supplier's invoice number",
        required: false,
        helpText: "The number as printed on the supplier's own invoice — never assigned by this company.",
      },
      {
        key: 'issueDate',
        kind: 'date',
        label: 'Issue date',
        required: false,
      },
      {
        key: 'dueDate',
        kind: 'date',
        label: 'Due date',
        required: false,
      },
      {
        key: 'currency',
        kind: 'select',
        label: 'Currency',
        required: false,
        options: CURRENCY_OPTIONS,
      },
      {
        key: 'netAmount',
        kind: 'money',
        label: 'Net amount (excl. VAT)',
        required: false,
        min: 0,
        currencyField: 'currency',
      },
      {
        key: 'vatAmount',
        kind: 'money',
        label: 'VAT amount',
        required: false,
        min: 0,
        currencyField: 'currency',
      },
      {
        key: 'grossAmount',
        kind: 'money',
        label: 'Gross amount (incl. VAT)',
        required: false,
        min: 0,
        currencyField: 'currency',
      },
    ],
    actions: [
      {
        id: 'receive',
        label: 'Save',
        transitions: RECEIVE_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(RECEIVE_TRANSITIONS),
      },
      {
        id: 'approve',
        label: 'Approve',
        transitions: APPROVE_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(APPROVE_TRANSITIONS),
      },
      {
        id: 'reject',
        label: 'Reject',
        transitions: REJECT_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(REJECT_TRANSITIONS),
      },
      {
        id: 'delete',
        label: 'Delete',
        // Not 'always' (see generic-actions.ts's registerDeleteAction — a never-saved record has no
        // documentId to act on) and not ['received', 'approved', 'rejected'] either — see this file's
        // own header on why deletion stops being offered once a review decision has been recorded.
        availableWhen: ['received'],
      },
    ],
  };
}

/**
 * Deliberately OUT of this wave (root TODO item 18's own scope note, carried here verbatim so the
 * decision travels with the type it applies to):
 *  - channel inboxes (KSeF inbound port, PDP/Peppol reception) — the poller remainder root TODO item
 *    10 already names; this type is filled by a human UPLOADING a file, never by a channel pushing
 *    one in automatically.
 *  - supplier reconciliation (matching a received invoice against this company's own purchase
 *    records) — no such records exist in this core today.
 *  - OCR of a scanned PDF — a pure PDF upload here always yields empty fields for the user to type,
 *    never a best-effort text recognition.
 */

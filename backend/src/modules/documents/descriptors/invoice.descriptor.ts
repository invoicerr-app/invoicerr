import { Currency } from '../../../../prisma/generated/prisma/client';
import { DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as the quote's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The invoice document type — the SECOND type written entirely as data, on the model of
 * quote.descriptor.ts. It exists as much to test the nine-kind core (field-kinds.ts) on something
 * that isn't the quote as to be a usable invoice form.
 *
 * Fields shared VERBATIM with the quote — client, issueDate, currency, notes, lines
 * (description/quantity/unitPrice) — are declared exactly the same way, deliberately: nothing about
 * an invoice needed a different KIND for any of them, only a different requiredness or a different
 * action-availability in the two places noted below. That is the outcome worth stating plainly: the
 * nine core kinds did not need to grow by one to describe an invoice.
 *
 * What actually distinguishes an invoice from a quote here, and why each one is here:
 *
 *  - `dueDate` is REQUIRED (the quote's is optional). A quote's due date is an optional validity
 *    window — a quote can stand with none. An invoice's due date is its payment deadline, central to
 *    what the document IS. Still the same `date` kind, no new kind needed — a requiredness
 *    difference on the same kind, decided per document type exactly the way `required` already
 *    varies per FIELD within one descriptor.
 *
 *  - `origin` (kind: 'reference', entities: ['quote', 'invoice']) — an invoice commonly traces back
 *    to an accepted quote (see "convert-to-invoice" on the quote, actions/quote-actions.ts), and
 *    recording that link is a purely structural fact about the document, not a business rule (no
 *    conversion, no copied totals, nothing computed). Optional: an invoice can exist with none. This
 *    field used to be called `originQuote` and target ONLY "quote" — it is now MULTI-TARGET
 *    (`entities`, not `entity`) because an invoice can just as well trace back to ANOTHER invoice
 *    (a corrective re-issue, a follow-up on a partial one) as to a quote; the field itself does not
 *    judge which case applies, it only records which one it is. Its stored value is therefore
 *    `{ entity: 'quote' | 'invoice', id: string }`, not a bare id — see types.ts's
 *    `MultiTargetReferenceValue` for why a bare id stopped being enough the moment more than one
 *    target became possible. It targets another document TYPE's own instances rather than a business
 *    entity from an existing service — see references/document-reference.provider.ts, a NEW provider
 *    THIS field needed (generalized, not duplicated, once the invoice itself also needed one for
 *    "invoice" — see documents.module.ts) — but the 'reference' field KIND itself and the generic
 *    /documents/references/:entity/... endpoints did not change at all to support it.
 *
 * Deliberately NOT added, and why — this is where the noyau could have been tempted, not where it
 * broke:
 *
 *  - An invoice "number". A free-text field would cost nothing to declare, but sequential, gapless,
 *    per-country invoice numbering is precisely a LEGAL rule — the exact kind of thing the removed
 *    compliance engine used to own, and this task explicitly asks not to reinvent. Even an inert,
 *    user-typed text field named "number" would misrepresent what this branch does (nothing here
 *    generates or enforces one), so it is left out rather than added quietly. This is a scope
 *    decision, not a limitation of the nine field kinds: `text` could hold a number field perfectly
 *    well if one were wanted.
 *  - Any tax/total field. Computing a total, or a VAT amount, is a fiscal rule, not a form field —
 *    the lines carry quantity and unit price exactly as the quote's do, and nothing here derives a
 *    sum from them (see actions/email-text.ts's formatLinesText, which lists lines and computes
 *    nothing either).
 *
 * Actions: "save-draft" is implemented, built on the exact same generic mechanism the quote uses
 * (actions/generic-actions.ts). "send" is implemented too, but DELIBERATELY NOT the quote's mechanism
 * — see actions/invoice-actions.ts's own comment for why an invoice's transport is read from the
 * ISSUING COMPANY's own configuration (TransportRegistry) rather than always being email. That is
 * also why, unlike the quote's "send", this action declares NO `params`: there is no user-typed
 * "recipient" here, because which transport runs — and what addressing it needs — is a company
 * setting, not something the person clicking "Send" types in on the spot. "record-payment" is
 * declared and deliberately NOT implemented: reconciling a payment needs a ledger/accounting pipeline
 * this branch does not build, the same discipline "convert-to-invoice" held the quote to before it
 * was implemented.
 */
export function buildInvoiceDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'invoice',
    label: 'Invoice',
    // See contributions/invoice-contributions.ts for the implementation — the first real one written
    // for this mechanism, and the model for any other type's own. Both locations, so it demonstrates
    // the small widget vocabulary on both.
    contributions: ['dashboard', 'statistics'],
    fields: [
      {
        key: 'client',
        kind: 'reference',
        label: 'Client',
        required: true,
        entity: 'client',
      },
      {
        key: 'origin',
        kind: 'reference',
        label: 'Origin document',
        required: false,
        entities: ['quote', 'invoice'],
        helpText: 'The quote or invoice this invoice was raised from, if any.',
      },
      {
        key: 'issueDate',
        kind: 'date',
        label: 'Date',
        required: true,
      },
      {
        key: 'dueDate',
        kind: 'date',
        label: 'Due date',
        required: true,
      },
      {
        key: 'currency',
        kind: 'select',
        label: 'Currency',
        required: true,
        options: CURRENCY_OPTIONS,
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
        availableWhen: 'always',
      },
      {
        id: 'send',
        label: 'Send',
        availableWhen: ['draft'],
        // No params — see this file's header comment: which transport runs, and what it needs to
        // address the delivery, is read from the company's own configuration, not typed here.
      },
      {
        id: 'record-payment',
        label: 'Record payment',
        // Recording a payment only makes sense once the invoice has actually been sent.
        availableWhen: ['sent'],
      },
    ],
  };
}

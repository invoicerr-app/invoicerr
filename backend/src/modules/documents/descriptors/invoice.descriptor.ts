import { Currency } from '../../../../prisma/generated/prisma/client';
import { DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as the quote's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The invoice document type — the SECOND type written entirely as data, on the model of
 * quote.descriptor.ts. It exists as much to test the ten-kind core (field-kinds.ts) on something
 * that isn't the quote as to be a usable invoice form.
 *
 * Fields shared VERBATIM with the quote — client, issueDate, currency, notes — are declared exactly
 * the same way, deliberately: nothing about an invoice needed a different KIND for any of them, only
 * a different requiredness or a different action-availability, noted below. `lines` used to be
 * shared verbatim too (description/quantity/unitPrice); it no longer is — see "the line shape" below
 * for why the invoice's own lines grew two fields the quote's did not, and why that is not yet a
 * quote/invoice difference so much as an "unfinished on the quote" one.
 *
 * ## The line shape — written FROM France, for now
 *
 * This pass follows the method the user asked for literally: "on fait un pays à la fois. On fait un
 * premier pays, on met dans le descripteur la description de ce que doit avoir une facture. Ensuite
 * on fait un autre pays, et si on se rend compte que certains champs étaient spécifiques au premier
 * pays, on les déplace dans le fichier du pays." France is that first pass. Every field below that
 * might turn out to be France's own, rather than universal, is marked "SUSPECTED FRANCE-SPECIFIC" —
 * a one-line flag for whichever second country's pass has to decide whether it moves into
 * country-fields/, not a claim that it definitely will.
 *
 * A line now carries FIVE fields — désignation, quantité, unité, prix unitaire, taux de TVA — the
 * minimum the business itself imposes everywhere, per the task this descriptor was rewritten for.
 * Two of them are new:
 *
 *  - `unit` — STRUCTURAL, not legal, so it carries no citation (see this file's own closing note on
 *    that distinction). EN 16931 (the socle format for France's e-invoicing reform — see
 *    documentation/compliance/FR-France.md §3.A, and the accepted-formats table there) models a
 *    line's quantity with a MANDATORY unit-of-measure code (BT-130, cardinality 1..1) sitting right
 *    next to the quantity itself (BT-129) — confirmed by the old canonical model's own fixtures at
 *    git tag `avant-refonte-documents` (e.g. `unitCode="C62"` on every BilledQuantity/
 *    InvoicedQuantity in compliance/schemas/en16931/* and compliance/providers/format/__fixtures__/*
 *    — "C62" being the UN/ECE Recommendation 20 code for "one/piece"). Declared here as free `text`,
 *    deliberately NOT a closed list of UN/ECE codes: nothing downstream in this branch renders or
 *    transmits an EN16931 XML today (the compliance engine that used to do that was removed
 *    entirely), so enforcing that exact vocabulary now would model for a consumer that does not
 *    exist — a future format-emitting consumer can tighten this into a closed `options` list (or a
 *    dedicated field kind) without needing to move the field out of the trunk. EN 16931 is a European
 *    norm, not a France-specific one, so this field is NOT flagged as suspected-French.
 *
 *  - `vatRate` (kind: 'select') — the concrete complaint this task started from: "y'a pas le select
 *    de TVA que j'avais dit de mettre". `options` is intentionally EMPTY in this trunk descriptor:
 *    the core names no country, so it cannot know any country's rates. `usesVatRateCatalog: true` is
 *    what tells descriptors/company-view.ts to fill `options` per company, from vat-rates/, for the
 *    ACTIVE company's resolved country. `allowCustomValue: true` is the escape hatch for a country
 *    with NO known catalog at all — never a dead control, and, just as importantly, never a way for
 *    a country WITH a known list to be bypassed either (see field-kinds.ts's 'select' validator: the
 *    escape only opens when `options` is actually empty).
 *
 *    SUSPECTED FRANCE-SPECIFIC: is "every invoice line carries exactly one ad-valorem VAT rate,
 *    chosen from a short national list" universal, or is it shaped by France's own VAT regime? A
 *    jurisdiction with no VAT at all (US sales tax: no per-line rate the same way — rate depends on
 *    product category AND the buyer's taxing jurisdiction, often not a single-line concept) may need
 *    this field REMOVED for it, not merely handed an empty catalog. Left in the trunk and required —
 *    exactly what France needs — because there is no second country's pass yet to say otherwise; a
 *    future one settles it, not a guess made here.
 *
 * What actually distinguishes an invoice from a quote here, beyond the line shape, and why each one
 * is here:
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
 *    decision, not a limitation of the field kinds: `text` could hold a number field perfectly well
 *    if one were wanted.
 *  - A per-line DISCOUNT ("remise"). Neither documentation/compliance/FR-France.md nor the "au
 *    minimum" list this task specified mentions one — adding it now would be exactly the kind of
 *    unrequested modeling this task's own "et rien de plus" instruction rules out. EN 16931 does
 *    have allowance/charge elements (e.g. BT-136), but reaching for them without a concrete need
 *    would be inventing scope, not following a justified one.
 *  - Any computed TAX AMOUNT or TOTAL. `vatRate` records a CHOICE the user makes about a line, not a
 *    computed figure — it costs nothing to store and nothing to derive from. Computing an actual tax
 *    amount, or a line/document total, is a fiscal or arithmetic rule this module still does not own
 *    (see contributions/invoice-contributions.ts's own `invoiceTotal`, deliberately quantity×
 *    unitPrice only, "no VAT, no rounding rule invented on top").
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
 *
 * A note on `unit`/`vatRate` NOT carrying a legal citation directly on the field: a purely
 * STRUCTURAL fact (there is a unit; there is a VAT-rate choice) is not itself a legal rule and needs
 * none — the modeling is free. What DOES need a citation is any claim about WHICH rates exist and
 * what they are worth for a given country, and that citation lives where the claim actually is: the
 * VAT rate catalog (vat-rates/data/fr.json), never repeated here.
 */
export function buildInvoiceDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'invoice',
    label: 'Invoice',
    // See contributions/invoice-contributions.ts for the implementation — the first real one written
    // for this mechanism, and the model for any other type's own. Both locations, so it demonstrates
    // the small widget vocabulary on both.
    contributions: ['dashboard', 'statistics'],
    // See types.ts's own comment on `listItem`, and quote.descriptor.ts for the same call on the
    // sibling type: `client` is required and the one thing a reader scans a list of invoices for.
    listItem: {
      titleFields: ['client'],
      secondaryFields: ['issueDate', 'dueDate', 'currency'],
    },
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
        // See this file's own header, "The line shape — written FROM France, for now", for why each
        // of these five fields is here and which ones are flagged as possibly France-only.
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
            // STRUCTURAL, not legal — EN 16931's BT-130 (mandatory unit-of-measure code). See this
            // file's header for the full reasoning on why this is free text, not a closed code list.
            key: 'unit',
            kind: 'text',
            label: 'Unit',
            required: true,
            helpText: 'How the quantity is counted — e.g. "hour", "day", "kg", "unit".',
          },
          {
            key: 'unitPrice',
            kind: 'money',
            label: 'Unit price',
            required: true,
            min: 0,
            currencyField: 'currency',
          },
          {
            // SUSPECTED FRANCE-SPECIFIC — see this file's header. `options` is filled per company by
            // descriptors/company-view.ts, from vat-rates/, never here.
            key: 'vatRate',
            kind: 'select',
            label: 'VAT rate',
            required: true,
            options: [],
            allowCustomValue: true,
            usesVatRateCatalog: true,
            helpText: 'The VAT rate that applies to this line.',
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

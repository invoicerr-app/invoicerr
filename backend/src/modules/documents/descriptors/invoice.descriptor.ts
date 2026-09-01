import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentFieldDescriptor, DocumentTypeDescriptor } from './types';

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
 * A line now carries SIX fields — désignation, quantité, unité, prix unitaire, taux de TVA, remise —
 * the minimum the business itself imposes everywhere, per the task this descriptor was rewritten for.
 * Two of them (`unit`, `vatRate`) were new at that pass; `discountPercent` was added in a LATER one
 * (see below).
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
 *  - `discountPercent` (kind: 'number', OPTIONAL, 0..100) — added in a later task (root TODO item 6),
 *    once a real need showed up: a per-line discount is universal invoicing arithmetic (it reduces
 *    the taxable base BEFORE VAT applies to it — see totals/compute-totals.ts's own header), not a
 *    national rule, so it carries no legal citation the way `vatRate`'s RATE does — only `min`/`max`
 *    to keep it a genuine percentage (see field-kinds.ts's 'number' validator, which already applies
 *    to an 'array' row's own subfields the same way it does to a top-level field — validate.ts
 *    recurses with the SAME registry per row). This is the bullet that used to say "deliberately NOT
 *    added" for exactly this reason ("no concrete need yet"); the need arrived, so the field did.
 *
 * `lines` also declares `prefillFrom: { entity: 'article', map: {...} }` — lets a row's UI offer a
 * "from catalog" button (field-renderers/array-field.tsx, frontend) that fills `description`/
 * `unitPrice`/`vatRate` from a picked Article (articles/articles.service.ts — the ONE module that
 * survived the pre-refactor architecture unchanged). See types.ts's own comment on `prefillFrom` for
 * the full, entity-agnostic mechanism; this descriptor only ever supplies the map, never any code.
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
 *  - An invoice "number" FIELD. This descriptor does NOT declare `number` among its `fields` — the
 *    number is not a user-typed value at all (see `numbering` below and numbering/), so it has no
 *    business being one more entry in this array the way a free-text field would be. A structural,
 *    system-assigned fact gets a structural mechanism (a descriptor-level declaration plus its own
 *    `DocumentInstance` columns), never a field a user could edit or leave blank.
 *  - Any computed TAX AMOUNT or TOTAL. `vatRate` records a CHOICE the user makes about a line, not a
 *    computed figure — it costs nothing to store and nothing to derive from. Computing an actual tax
 *    amount, or a line/document total, is a fiscal or arithmetic rule this module still does not own
 *    (see contributions/invoice-contributions.ts's own `invoiceTotal`, deliberately quantity×
 *    unitPrice only, "no VAT, no rounding rule invented on top").
 *
 * Numbering: `onEnterStatus: 'sending'` (TODO.md item 22 moved this from "sent" — see this file's own
 * lifecycle paragraph below) — an invoice receives its number the moment it STARTS being sent, so the
 * number is already on the record (and therefore on whatever PDF a transport attaches) before
 * delivery is even attempted, deliberately still at ISSUANCE rather than at creation, exactly like
 * the old, removed engine. What this does NOT claim: sequential, GAPLESS, per-country invoice
 * numbering is a LEGAL property some jurisdictions attach to an issued invoice (see this file's own
 * `invoice.save-draft` note in country-policy/data/fr.json, and that file's top-level `notes`) —
 * numbering/sequence.ts's own mechanism never wastes a number, which reduces gap risk without
 * asserting the legal claim itself.
 *
 * Actions: "save-draft" is implemented, built on the exact same generic mechanism the quote uses
 * (actions/generic-actions.ts). "send" is implemented too, but DELIBERATELY NOT the quote's mechanism
 * — see actions/invoice-actions.ts's own comment for why an invoice's transport is read from the
 * ISSUING COMPANY's own configuration (TransportRegistry) rather than always being email. That is
 * also why, unlike the quote's "send", this action declares NO `params`: there is no user-typed
 * "recipient" here, because which transport runs — and what addressing it needs — is a company
 * setting, not something the person clicking "Send" types in on the spot. Since item 22, "send" is
 * also ASYNCHRONOUS (actions/async-send.ts) exactly like the quote's own — see this file's lifecycle
 * paragraph below for the shape.
 *
 * "record-payment" is now IMPLEMENTED (actions/invoice-actions.ts) — payments (settlement/) landed
 * this task. Its `params` reuse the exact same field vocabulary a document's own `fields` use
 * (money/select/date/text — see types.ts's `DocumentActionDescriptor.params`): `amount` (the payment
 * itself), `currency` (checked against the invoice's own — see the handler for why a mismatch is
 * refused rather than silently converted), `paidAt` (defaulted to today by a params-defaults
 * resolver, the same mechanism "send"'s recipient pre-fill already uses), and `method`/`note`
 * (product-only vocabulary, no legal weight — see the `method` field's own comment). "export-accounting"
 * is the NEW declared-but-unimplemented example: a real future need (a chart-of-accounts mapping, a
 * ledger export format this branch does not build), the same role "record-payment" used to hold
 * before this task, and "convert-to-invoice" held for the quote before it was implemented. The 501
 * mechanism this proves lives on THIS action now — see documents.service.invoice.spec.ts.
 *
 * "download-xml" (root TODO item 12, "formats normalisés") is declared here but, unlike every other
 * action above, is NOT run through `ActionRegistry`/`runAction` at all — it produces BINARY bytes
 * (an XML document), not the JSON `ActionResult` every registered handler returns, so it has no
 * business pretending to fit that shape. It exists on THIS descriptor purely so the same four gates
 * (country policy 403, status 409, implementation 501, validation 400) apply to it — see
 * `documents.service.ts#downloadDocumentFormat`'s own header for exactly how, and `documents/
 * formats/`'s own module for the descriptor → EN 16931 bridge and the real XSD/Schematron gate. The
 * actual download is a GET endpoint (the same "download, not an action result" shape "GET .../pdf"
 * already holds), never a POST to `.../actions/download-xml`.
 *
 * A note on `unit`/`vatRate` NOT carrying a legal citation directly on the field: a purely
 * STRUCTURAL fact (there is a unit; there is a VAT-rate choice) is not itself a legal rule and needs
 * none — the modeling is free. What DOES need a citation is any claim about WHICH rates exist and
 * what they are worth for a given country, and that citation lives where the claim actually is: the
 * VAT rate catalog (vat-rates/data/fr.json), never repeated here.
 *
 * Lifecycle: FOUR statuses — "draft", "sending", "sent", "send_failed" — grown from the original two
 * by item 22, on the exact same model as the quote's own (see quote.descriptor.ts's lifecycle
 * paragraph for the full design, actions/async-send.ts for the shared mechanism, and
 * TODO_ISSUES.md for the "sent before delivery actually succeeded" limit this replaces).
 * "save-draft" (generic-actions.ts's registerSaveDraftAction) always persists "draft", from ANY
 * current status (`from: 'always'`) — faithful to the handler's actual, literal behavior, not an
 * invented rule. "send" (invoice-actions.ts) now has the same two transition entries the quote's own
 * does: "draft"/"send_failed" -> "sending" (the API's synchronous call — a fresh send or a retry),
 * then "sending" -> "sent" OR "send_failed" (the worker's replay). `availableWhen` is DERIVED from
 * BOTH (lifecycle.ts's header), so it includes "sending" too — see quote.descriptor.ts's own comment
 * on why that is necessary for the worker, not an invitation for a human to re-click mid-flight.
 *
 * "record-payment" declares an explicit `availableWhen: ['sent']` (deliberately UNCHANGED by item 22
 * — a payment is only meaningful once the invoice has genuinely been delivered, never while it is
 * still "sending" or after it "send_failed") and, DELIBERATELY, still NO
 * `transitions` — even though it is now implemented. A payment reaching (or exceeding) the invoice's
 * total does NOT flip the status to some invented "paid": the STATUS stays the declared lifecycle
 * (draft/sent), and the BALANCE (settlement/compute-settlement.ts's `computeSettlement`) is a
 * PROJECTION computed on read, displayed as a derived badge ("Paid"/"Partially paid" — see the
 * frontend's settlement components), never a status this descriptor would have to invent a
 * transition for. Two real designs were on the table here: (a) declare `record-payment`'s own
 * `to: 'paid'` and accept that the FIRST euro paid would already flip a partially-paid invoice's
 * status (transitions have no notion of "conditionally, only once the balance clears") — wrong, an
 * invoice with one euro paid out of a thousand is not "paid"; (b) the one built: no status change at
 * all, ever, from this action. (b) also keeps the door open for a future "paid" STATUS the day
 * reconciliation (credit notes, item 8 — lettrage) needs one, without this task inventing it first on
 * a guess. "export-accounting" likewise declares no `transitions`: unimplemented, so there is no
 * handler behavior yet to declare a status effect for.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];

/**
 * "record-payment"'s own params — the exact same field vocabulary the document's own `fields` use
 * (see `DocumentActionDescriptor.params`'s comment in types.ts), never a second, bespoke shape.
 *
 *  - `amount`/`currency`: a 'money' field paired with a 'select' sibling via `currencyField`, the
 *    identical pattern the invoice's own `lines[].unitPrice` already uses for `currency` — except
 *    here the sibling is another PARAM (`currency`), not a document field, because a payment's own
 *    dialog has no access to the document's `data` at all (a separate namespace — see
 *    actions/action-registry.ts's `ActionContext`). `currency` is defaulted to the invoice's own
 *    currency by a params-defaults resolver (invoice-actions.ts, the same mechanism "send"'s
 *    `recipient` pre-fill already uses for the quote) — a user recording a payment never has to think
 *    about it in the ordinary case, but a value CAN still be picked here that differs from the
 *    invoice's own, which is exactly what the handler checks for and refuses (no conversion — that is
 *    item 9 of the root TODO, not this one).
 *  - `paidAt`: defaults to TODAY via the same params-defaults resolver, editable for a payment
 *    received earlier and only just being recorded.
 *  - `method`: PRODUCT labels, not a legal classification — "how the customer says they paid",
 *    useful for a bookkeeper skimming a list, carrying no fiscal meaning of its own. Optional: a
 *    payment can be recorded before its method is known or worth naming.
 *  - `note`: free text, optional, for whatever context doesn't fit the fields above (a reference
 *    number, "paid by the client's accountant directly", ...).
 */
const RECORD_PAYMENT_PARAMS: DocumentFieldDescriptor[] = [
  {
    key: 'amount',
    kind: 'money',
    label: 'Amount',
    required: true,
    currencyField: 'currency',
  },
  {
    key: 'currency',
    kind: 'select',
    label: 'Currency',
    required: true,
    options: CURRENCY_OPTIONS,
  },
  {
    key: 'paidAt',
    kind: 'date',
    label: 'Paid at',
    required: true,
  },
  {
    key: 'method',
    kind: 'select',
    label: 'Method',
    required: false,
    options: [
      { value: 'bank_transfer', label: 'Bank transfer' },
      { value: 'card', label: 'Card' },
      { value: 'cash', label: 'Cash' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'note',
    kind: 'text',
    label: 'Note',
    required: false,
  },
];

export function buildInvoiceDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'invoice',
    label: 'Invoice',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      { id: 'sent', label: 'Sent' },
      { id: 'send_failed', label: 'Send failed' },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'sending' },
    // See types.ts's own comment on `DocumentTypeDescriptor.email`, and quote.descriptor.ts for the
    // same call on the sibling type — sober, plain-English default, overridable per company.
    email: {
      subject: '{typeLabel} {displayNumber} from {companyName}',
      body:
        'Dear {recipientName},\n\n' +
        'Please find attached {typeLabel} {displayNumber} from {companyName}, for a total of ' +
        '{totalGross}.\n\n' +
        'Best regards,\n{companyName}',
    },
    // Root TODO item 15 ("mentions obligatoires") — see types.ts's own comment on this flag. BG-1
    // (EN 16931's mentions block) is an invoice concept; the invoice is the first, and today the
    // only, type that opts in.
    usesLegalMentions: true,
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
        // of these six fields is here and which ones are flagged as possibly France-only.
        //
        // `description` maps from the article's `name`, not its own `description`: this line shape
        // has one free-text designation field, not the separate name+description pair the old,
        // removed article-line form used to have.
        prefillFrom: {
          entity: 'article',
          map: { description: 'name', unitPrice: 'unitPrice', vatRate: 'vatRate' },
        },
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
          {
            // See this file's own header for why this is universal arithmetic, not a national rule.
            key: 'discountPercent',
            kind: 'number',
            label: 'Discount %',
            required: false,
            min: 0,
            max: 100,
            helpText: 'Percentage discount applied to this line, before VAT.',
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
        // No params — see this file's header comment: which transport runs, and what it needs to
        // address the delivery, is read from the company's own configuration, not typed here.
      },
      {
        id: 'record-payment',
        label: 'Record payment',
        // Recording a payment only makes sense once the invoice has actually been sent — one cannot
        // encash a brouillon. NO `transitions`: see this file's own lifecycle comment above for why —
        // now IMPLEMENTED (actions/invoice-actions.ts), but its effect lands on a NEW DocumentPayment
        // row and the projected balance, never on this record's own declared status.
        availableWhen: ['sent'],
        params: RECORD_PAYMENT_PARAMS,
      },
      {
        id: 'download-xml',
        label: 'Download normalized XML',
        // "Available once numbered" — the same GUARD `documents/formats/`'s own header on
        // `documents.service.ts#downloadDocumentFormat` explains: EN 16931's BT-1 (Invoice number)
        // has cardinality 1..1, and a "draft" has none (numbering/, `numbering.onEnterStatus:
        // 'sending'` above) — so this action is offered from EXACTLY the same three statuses a
        // number is already guaranteed to exist on: 'sending' (the number is taken the moment this
        // status is FIRST entered, before delivery itself is even attempted — see this file's own
        // numbering paragraph), 'sent', and 'send_failed' (a failed SEND does not un-number the
        // document — see `DocumentInstance.number`'s own schema comment: never cleared once set).
        // NO `transitions`: like "record-payment"/"export-accounting", downloading a normalized
        // export has no status effect of its own on this record.
        availableWhen: ['sending', 'sent', 'send_failed'],
        params: [
          {
            key: 'syntax',
            kind: 'select',
            label: 'Syntax',
            required: true,
            options: [
              { value: 'cii', label: 'CII (UN/CEFACT Cross Industry Invoice)' },
              { value: 'ubl', label: 'UBL 2.1' },
              // Root TODO item 10, wave 1 — see formats/facturx-provider.ts's own header for the
              // reuse this resolves (TODO_ISSUES.md's "Factur-X : embarqueur existant au repère").
              { value: 'facturx', label: 'Factur-X (PDF/A-3 with embedded CII)' },
              // Root TODO item 10, wave 2 — `fa3`/`fatturapa` are TRANSPORT-only by default (see
              // `ksef-transport.ts`/`sdi-transport.ts`'s own headers), added here too only because it
              // costs nothing: neither builder needs anything this action doesn't already pass every
              // other syntax (descriptor/document/company/client), so this is two more option entries,
              // not new plumbing. NOT gated by the calling company's own country — like every other
              // entry in this list, `download-xml` never asks "does this company's country match this
              // syntax", the same way a French company can already download a `ubl` export today.
              { value: 'fa3', label: 'FA(3) — Polish KSeF national schema' },
              { value: 'fatturapa', label: 'FatturaPA — Italian SdI national schema' },
            ],
          },
        ],
      },
      {
        id: 'export-accounting',
        label: 'Export to accounting',
        // The NEW declared-but-unimplemented action — see this file's own header on why this, and not
        // "record-payment" anymore, is what documents.service.invoice.spec.ts's 501 test now targets.
        // A real future need (a chart-of-accounts mapping, a ledger export format) this branch does
        // not build today. Gated the same way "record-payment" is: an accounting export of a document
        // that was never actually issued makes no sense either.
        availableWhen: ['sent'],
      },
      {
        id: 'share-link',
        label: 'Share link',
        // Root TODO item 24 ("liens publics de téléchargement") — declared here for EXACTLY the same
        // reason "download-xml" above is: a company sharing a public download link is an ACTION this
        // country's document-action policy should get an opinion on (a country's data-protection or
        // professional-secrecy posture on "give an unauthenticated third party a link to this
        // document" is a real, distinct question from "may this action run on this type at all" —
        // even though every shipped policy file today answers it the same permissive, `unverified`
        // way "download-xml" already does — see country-policy/data/fr.json's own new entry). This
        // is NOT registered as an `ActionRegistry` handler (documents-core.module.ts) — unlike
        // "download-xml" it does not need the bypass for a BINARY-payload reason (creating a share
        // link returns plain JSON, which fits `ActionResult` fine) but for a ROUTE-SHAPE reason
        // instead: share-links/share-links.service.ts's own create/list/revoke are REST resources
        // under "/documents/:id/share-link[s]" (create a link, list active links, revoke one by id),
        // not a single POST-and-forget action — a shape `runAction`'s generic
        // "POST .../actions/:actionId" endpoint was never built to express. `documents.controller.ts`
        // runs the SAME two gates by hand (country policy 403, status 409) before calling into that
        // service, on the same model `documents.service.ts#downloadDocumentFormat`'s own four-gate
        // comment documents — only two of those four ever have anything to say for THIS action
        // (there is no format to pick, so no 501; no document to build and validate, so no 400).
        //
        // "Available once numbered" — same three statuses as "download-xml": a draft has no number
        // (numbering/, `numbering.onEnterStatus: 'sending'` above) and, this ticket's own words, "no
        // legal existence" to hand a stranger a link to yet.
        availableWhen: ['sending', 'sent', 'send_failed'],
      },
    ],
  };
}

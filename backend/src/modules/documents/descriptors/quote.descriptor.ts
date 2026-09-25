import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { standardDocumentEmailTranslations } from './standard-email-translations';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/**
 * The reference currency list is the existing `Currency` enum (used everywhere else money is
 * entered, e.g. clients/expenses) — reused, not reinvented, and it carries no rate or rule, only
 * the closed list of codes.
 */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The quote document type, entirely as data: no bespoke service, no controller of its own. Fields:
 * client (reference), issue date, due date, currency, notes, and repeatable lines (designation,
 * quantity, unit price, VAT rate, a per-line discount, an optional work date). Actions: save the
 * draft and send by email
 * (both implemented, see actions/quote-actions.ts — sending a QUOTE by email is this type's own
 * nature, not a mechanism it shares with the invoice, see invoice-actions.ts), convert-to-invoice
 * (implemented, see actions/convert-to-invoice.ts — it used to be the live "declared but not
 * implemented" case this registry proves a 501 against; that role passed to the invoice's
 * "record-payment" next, then to "export-accounting" once "record-payment" was itself implemented —
 * see invoice.descriptor.ts), and request-deposit (implemented, see actions/request-deposit.ts — the
 * minimal, honest replacement for the old, removed "deposit invoice" concept: it creates a brand-new
 * draft INVOICE for N% of this quote's own total, the same "acts on a quote, writes an invoice"
 * shape convert-to-invoice already has, sharing that skeleton via actions/quote-to-invoice.ts), and
 * request-installments (implemented — see
 * actions/request-installments.ts — N draft INVOICES, one per milestone, whose gross totals sum to
 * this quote's own TTC exactly; unlike request-deposit it REFUSES a quote mixing more than one VAT
 * rate rather than leaving a line's rate unset, because its whole acceptance criterion depends on
 * exactly one rate applying uniformly — see that file's own header).
 *
 * Lifecycle: FOUR statuses — "draft", "sending", "sent", "send_failed" (grown from the original two
 * by the async-send mechanism, actions/async-send.ts — see its own header for the
 * full design and the "sent before the email actually left" limit it replaces).
 * "save-draft" is faithful to what `registerSaveDraftAction` actually does: it persists "draft"
 * REGARDLESS of the record's current status (even from "sent" — the literal, if slightly surprising,
 * behavior the handler already had before this file's own `transitions` existed to name it), hence
 * `from: 'always'`. "send" now has TWO transition entries, not one:
 *  - "draft"/"send_failed" -> "sending": the API's own synchronous call (a fresh send, or a retry —
 *    a retry IS this same action, not a separate mechanism);
 *  - "sending" -> "sent" OR "send_failed": the worker's REPLAY of this same action (see
 *    queue/processors/document-action.processor.ts), which is why `to` is an ARRAY here — the same
 *    invocation can honestly land on either outcome, and `checkTransitionResult` (lifecycle.ts)
 *    accepts either. `availableWhen` below is DERIVED from BOTH entries (lifecycle.ts's header), so
 *    it now includes "sending" too — necessary for the worker's replay to pass the same 409 gate a
 *    human click would. A second, genuinely external call reaching this same branch (double-click, a
 *    second tab, an HTTP retry — the frontend hiding an in-flight record's own action buttons,
 *    document-list.tsx, is a UI courtesy, never a server-side guarantee) is harmless by construction,
 *    not merely unlikely: `actions/async-send.ts`'s own claim — an in-process `Set` short-circuit
 *    backed by `persistence.ts#claimDocumentTransition`'s database-level compare-and-swap, that file's
 *    own header — lets exactly ONE caller, anywhere, actually run `deliver()`, refusing every other one
 *    with a 409 before it ever touches a transport — see that file's own "delivery claim" tests.
 * "convert-to-invoice" and "request-deposit" declare NO transition: neither ever changes the QUOTE's
 * own status — each one's entire effect is a brand-new INVOICE elsewhere (convert-to-invoice.ts,
 * request-deposit.ts) — so their `availableWhen` stays its own explicit, hand-declared fact, exactly
 * as it was for "convert-to-invoice" before this cycle mechanism existed.
 *
 * Numbering: `onEnterStatus: 'sending'` (moved here from "sent" by the async-send mechanism) — a quote receives its
 * number the moment it starts being sent, not once delivery actually succeeds, so the number is
 * already on the record (and therefore on the PDF) by the time `deliver()` ever runs — see
 * numbering/ for the full mechanism. `number` is never cleared once set: a "send_failed" retry
 * re-enters "sending" with the SAME number, never a fresh one (no gap, no duplicate).
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];
// Issue #421: "accept a quote manually, without the e-signature code". Only from "sent" - the issue's
// own wording ("a sent quote can be marked accepted") and the same "one cannot cash a draft" reasoning
// "request-deposit"/"request-signature" already hold below: a quote the client hasn't received yet has
// nothing to have been accepted BY. Deliberately NOT also from "send_failed" (a send that never
// actually reached the client cannot honestly be "accepted" by them either) nor from "signed"/
// "accepted" themselves (see actions/quote-manual-acceptance.ts's own header on why an ALREADY
// e-signed or ALREADY manually-accepted quote refuses a second acceptance of either kind, with a 409
// naming which one already happened).
const ACCEPT_MANUALLY_TRANSITIONS: DocumentActionTransition[] = [{ from: ['sent'], to: 'accepted' }];

export function buildQuoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'quote',
    label: 'Quote',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      // `clientVisible` (see `DocumentStatusDescriptor`'s own header) — this is what a client portal
      // session (`client-portal/`) shows: a quote awaiting the client's own response.
      { id: 'sent', label: 'Sent', clientVisible: true },
      { id: 'send_failed', label: 'Send failed' },
      // Reached ONLY through the public OTP-signature flow
      // (signatures/signatures.service.ts#markSigned), never through `runAction`/`ActionRegistry`:
      // there is no authenticated caller to run a "sign" action AS, the client is anonymous. No
      // action below declares a `transitions` entry targeting this status (see lifecycle.ts's own
      // header — a status need not be some action's own transition target to be validly declared),
      // so `validateLifecycle` never expects one; `findUndeclaredStatusInstances`
      // (documents.service.ts's own boot check) is the reason this status must be declared here at
      // all — otherwise every signed quote would read as an undeclared-status anomaly.
      { id: 'signed', label: 'Signed', clientVisible: true },
      // Issue #421: the client accepted the quote by some OTHER means (a phone call, a reply email, a
      // signed paper scan) and the ISSUER records that fact - unlike "signed" right above, this DOES
      // go through `runAction`/`ActionRegistry` (see the "accept-manually" action below and
      // actions/quote-manual-acceptance.ts): there IS an authenticated company member to run it as, a
      // manual acceptance is exactly the kind of company-side write this mechanism already exists for.
      // A DISTINCT status from "signed", deliberately never reused: the whole point of this status is
      // that neither the archive, the audit log, the detail page's "Acceptance" section (this app has
      // no document history/timeline view), nor any consumer of "was this quote accepted" (the
      // client portal, a webhook, a list filter) can mistake one for the other - see that action's own
      // header, and its own audit of every place this codebase reads a quote's "signed" status for what
      // needed to change (nothing did: contributions/quote-contributions.ts's own "open quotes"/"sent"
      // counts never included "signed" either, so "accepted" needs no new inclusion there; no webhook,
      // list filter, or the client portal ever branches on "signed" by name - `clientVisible` alone is
      // what surfaces a status to the portal, which "accepted" gets here for the same reason "signed"
      // has it: the client's own "yes" is exactly as visible whichever way it was recorded).
      { id: 'accepted', label: 'Accepted', clientVisible: true },
      // The client PORTAL's own "decline" - `client-portal/portal.service.ts#refuseQuote`. Reached
      // the EXACT same way "signed" above is: a WRITE outside `runAction`/`ActionRegistry` (there is
      // no company-authenticated caller to run an action AS — a portal session is a CLIENT, not a
      // company member), hand-guarded the identical way `SignaturesService`'s own private
      // `markSigned` guards "signed" (only from "sent", a 409 otherwise). Declined WITHOUT going
      // through the OTP-hardened signature path on purpose: refusing carries no legal weight the way
      // accepting does (nothing is signed, nothing is non-repudiable), so it needs none of that
      // mechanism's guarantees — see `client-portal/portal.service.ts`'s own header.
      { id: 'refused', label: 'Refused', clientVisible: true },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'sending' },
    // See types.ts's own comment on `DocumentTypeDescriptor.email` — sober, plain-English default,
    // overridable per company. `recipientName` resolves from `client` below (the field the ONLY
    // 'reference' field targeting the "client" entity on this type — see
    // actions/email-template.ts's `buildEmailTemplateParts`).
    email: {
      subject: '{typeLabel} {displayNumber} from {companyName}',
      body:
        'Dear {recipientName},\n\n' +
        'Please find attached {typeLabel} {displayNumber} from {companyName}, for a total of ' +
        '{totalGross}.\n\n' +
        'Best regards,\n{companyName}',
    },
    // Per-recipient document language — see types.ts's own comment on `emailTranslations`, and
    // standard-email-translations.ts's own header on why this is shared, word-for-word, with
    // invoice.descriptor.ts rather than duplicated.
    emailTranslations: standardDocumentEmailTranslations(),
    // See contributions/quote-contributions.ts for the implementation — the THIRD real contribution
    // written for this mechanism. Both locations: a draft-quotes shortlist on the dashboard, a
    // "Quotes sent" count plus a fully detailed table on statistics.
    contributions: ['dashboard', 'statistics'],
    // See types.ts's own comment on `listItem`. `client` is the one field a quote cannot exist
    // without (required) and the one a reader actually wants to see first in a list of quotes.
    listItem: {
      titleFields: ['client'],
      // `clientReference` is last and `hideWhenEmpty` (see that field's own comment above) — most
      // quotes will never set it, so it never crowds the line for the common case, and the frontend's
      // own `document-list.tsx` honors the SAME hint to skip it there too.
      secondaryFields: ['issueDate', 'dueDate', 'currency', 'clientReference'],
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
        key: 'issueDate',
        kind: 'date',
        label: 'Date',
        required: true,
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
        required: true,
        options: CURRENCY_OPTIONS,
      },
      {
        key: 'notes',
        kind: 'longText',
        label: 'Notes',
        required: false,
      },
      // "client reference / PO number" — a free-text slot for the
      // BUYER's own internal reference (their purchase order, a file/dossier number): quasi-universal
      // on a competitor's quote/invoice form, and required in practice by most B2G/B2B buyers for
      // their OWN reconciliation, even though nothing in French or EU law forces a seller to carry it.
      // Deliberately NOT `notes` (free text already exists and nobody types a PO number into it in
      // practice — the whole point is a field a buyer's accounts-payable system can find at a FIXED
      // key) and deliberately NOT the same key as the DE country-fields overlay's own `buyerReference`
      // (country-fields/data/de.json): that field is wired into a REAL compliance mechanism this descriptor
      // must not touch — EN 16931's BT-10 on the CII/UBL export (`formats/shared-build.ts`), XRechnung's
      // BR-DE-15, Peppol's PEPPOL-EN16931-R003, and Germany's/France's own B2G required-field rules
      // (`b2g-routing/data/*.json`) all read `data.buyerReference` specifically. Reusing that key here
      // would either silently feed a user-typed convenience note into a legal EN 16931 field it was
      // never vetted for, or — worse — collide outright: `country-fields/apply-overlay.ts`'s own `add`
      // operation THROWS when a key it is about to add already exists on the trunk descriptor, so a DE
      // company would get a hard 500 building its OWN invoice form the moment this field's key matched.
      // `clientReference` stays a distinct, purely product-level fact: universal, optional, carrying no
      // legal citation and touching no format/transport/B2G mechanism at all — see this field's own
      // `hideWhenEmpty` for why it degrades to invisible rather than a permanent empty placeholder.
      {
        key: 'clientReference',
        kind: 'text',
        label: 'Client reference / PO number',
        required: false,
        helpText: "The buyer's own reference for this document — their purchase order or file number.",
        hideWhenEmpty: true,
      },
      {
        key: 'lines',
        kind: 'array',
        label: 'Lines',
        required: true,
        min: 1,
        // Lets each row offer a "from catalog" button (field-renderers/array-field.tsx, frontend)
        // that fills `description`/`unitPrice`/`vatRate` from a picked Article — see types.ts's own
        // comment on `prefillFrom` for the full mechanism, and articles/articles.service.ts for the
        // Article shape these map keys name (`name`, `unitPrice`, `vatRate` — the ITEM's own business
        // fields, never `unitPriceMinor`, an internal storage detail). `description` maps from the
        // article's `name`, not its own `description`: this line shape has a single free-text
        // designation field, not the separate name+description pair the old, removed article-line
        // form used to have — see the 14-articles.cy.ts spec this was built to make pass again.
        prefillFrom: {
          entity: 'article',
          // `articleId: 'id'` (basic stock management) — see
          // article-reference.provider.ts's own `getFields` comment for why `id` is there to map
          // from, and invoice.descriptor.ts's identical `articleId` field for the full "why".
          map: { articleId: 'id', description: 'name', unitPrice: 'unitPrice', vatRate: 'vatRate' },
        },
        fields: [
          {
            key: 'description',
            kind: 'text',
            label: 'Designation',
            required: true,
          },
          {
            // See invoice.descriptor.ts's identical field for the full
            // "why". A quote never itself decrements stock (only an invoice's own ISSUANCE does — see
            // documents.service.ts's call site), but this line still carries the pointer: "convert to
            // invoice" (actions/convert-to-invoice.ts) copies `lines` VERBATIM, `articleId` included,
            // so a quote line picked from the catalog keeps pointing at its article once it becomes a
            // real, stock-decrementing invoice line — no separate mechanism needed for that to happen.
            key: 'articleId',
            kind: 'hiddenReference',
            label: 'Article',
            required: false,
            entity: 'article',
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
          {
            // Same field as on the invoice (invoice.descriptor.ts): a quote states a price, and a
            // price without its VAT rate does not say what the client will pay. OPTIONAL here, where
            // the invoice requires it: pricing without detailing the tax remains a valid quote — this
            // is a product choice, not a legal rule.
            key: 'vatRate',
            kind: 'select',
            label: 'VAT rate',
            options: [],
            allowCustomValue: true,
            usesVatRateCatalog: true,
            helpText: 'The VAT rate that applies to this line.',
          },
          {
            // A PER-LINE discount — universal invoicing arithmetic (it reduces the pre-tax base
            // before VAT applies to it, see totals/compute-totals.ts), not a particular country's
            // fiscal rule: no citation to carry here, unlike `vatRate` above whose RATE genuinely is
            // a national fact. Optional (a line with no discount stays the ordinary line as before);
            // `min`/`max` are what prevents a -20% from turning into a price markup on the
            // calculation side — see field-kinds.ts's 'number' validator (numberRangeError), which
            // already applies to an 'array' subfield the same way it does to any top-level field
            // (validate.ts recurses with the SAME registry for each row).
            key: 'discountPercent',
            kind: 'number',
            label: 'Discount %',
            required: false,
            min: 0,
            max: 100,
            helpText: 'Percentage discount applied to this line, before VAT.',
          },
          {
            // Same field as the invoice's own (invoice.descriptor.ts's "The line shape" header,
            // issue #145) — added here too, for consistency, and because `convert-to-invoice`
            // (actions/convert-to-invoice.ts) copies `lines` VERBATIM: a quote line already carrying
            // a work date (a proposal for work planned on a specific day) keeps that value once it
            // becomes a real invoice line, exactly like `articleId` above already does. A quote's own
            // work is typically NOT yet done (the client hasn't accepted it), so this is read as "the
            // planned/expected date" here rather than invoice.descriptor.ts's "date actually worked" —
            // the field records a date, not which of the two meanings applies; nothing in this
            // descriptor forces either reading. `hideWhenEmpty: true` — same column-level meaning
            // inside an 'array' row, see invoice.descriptor.ts's own bullet and
            // rendering/render-html.ts's 'array' case for the mechanism.
            key: 'date',
            kind: 'date',
            label: 'Work date',
            required: false,
            hideWhenEmpty: true,
            helpText: 'When the work on this line is due, or was done, if it differs from the quote date.',
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
        // Reuses the exact same field vocabulary as the document's own `fields` above — this is not
        // a second, action-specific shape. `recipient` is deliberately not sourced from `client`
        // automatically: the params-defaults resolver (registerQuoteActions) pre-fills it from the
        // client's contact email when one is set, but the user can still send elsewhere.
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
        id: 'convert-to-invoice',
        label: 'Convert to invoice',
        // "signed"/"accepted" added by issue #421 ("accept a quote manually, without the e-signature
        // code"): its own acceptance criterion is "conversion to an invoice works from 'accepted' as it
        // does from 'signed'" - before this change, NEITHER actually appeared here (only "draft"/
        // "sent" did, a pre-existing gap this fixes as part of the same audit: a company that has an
        // e-signed OR a manually-accepted quote in hand must be able to invoice it, exactly like one
        // still merely "sent"). A quote's own e-signature/manual-acceptance status has no bearing on
        // whether it is fit to become a draft invoice - the SAME copy-lines-and-open-a-draft effect
        // (actions/convert-to-invoice.ts) applies regardless of which of the four statuses triggered it.
        availableWhen: ['draft', 'sent', 'signed', 'accepted'],
      },
      {
        id: 'request-deposit',
        label: 'Request deposit',
        // Only once the quote has actually been SENT — the same reasoning invoice.descriptor.ts's
        // own "record-payment" already holds ("one cannot cash a draft"): asking a client for
        // a deposit on a quote they have not even received yet makes no sense. This is also the
        // quote's own `numbering.onEnterStatus`, so a quote this action can run against is always
        // already numbered — see actions/request-deposit.ts's own header.
        availableWhen: ['sent'],
        // NO `transitions`: exactly like "convert-to-invoice" right above, this action's entire
        // effect is a brand-new INVOICE elsewhere (actions/request-deposit.ts) — it never changes
        // THIS quote's own status.
        params: [
          {
            key: 'percent',
            kind: 'number',
            label: 'Deposit percentage',
            required: true,
            min: 1,
            max: 100,
          },
        ],
      },
      {
        id: 'request-installments',
        label: 'Generate installment invoices',
        // Acceptance criterion: "a quote with 3 installments generates 3 draft invoices on the
        // planned dates, summing to the quote's own gross total". Same "only once actually sent"
        // reasoning as "request-deposit" right above (a quote the client hasn't received yet has no
        // installment plan to honor), and the same reason it needs no `transitions`: this action's
        // entire effect is N brand-new INVOICES elsewhere (actions/request-installments.ts) — it
        // never changes THIS quote's own status.
        availableWhen: ['sent'],
        params: [
          {
            key: 'milestones',
            kind: 'array',
            label: 'Milestones',
            required: true,
            // Structural floor only — the handler's own computeMilestoneSplit re-checks this (never
            // trusts a descriptor gate alone, the same discipline every other action handler here
            // holds) and is where the REAL business rules live: percents summing to exactly 100, each
            // one strictly positive.
            min: 2,
            fields: [
              {
                key: 'percent',
                kind: 'number',
                label: 'Percentage',
                required: true,
                min: 0,
                max: 100,
              },
              {
                key: 'dueDate',
                kind: 'date',
                label: 'Due date',
                required: true,
              },
            ],
          },
        ],
      },
      {
        id: 'request-signature',
        label: 'Request signature',
        // See actions/request-signature.ts's own header (the hardened
        // OTP-by-email reintroduction of the removed `modules/signatures/`). Only once 'sent' — the
        // identical reasoning "request-deposit" right above already holds: asking a client to sign a
        // quote they have not even received yet makes no sense, and 'sent' is also this type's own
        // `numbering.onEnterStatus`, so a quote this action can run against is always already
        // numbered (the signature-request email's own {{SIGNATURE_NUMBER}} — signatures.service.ts).
        availableWhen: ['sent'],
        // NO `transitions`: exactly like "request-deposit"/"convert-to-invoice" right above, this
        // action's entire effect is a brand-new `Signature` row plus an email
        // (signatures/signatures.service.ts) — it never changes THIS quote's own status itself. The
        // eventual "sent" -> "signed" transition happens entirely outside `runAction`, the moment the
        // anonymous client verifies their OTP - see quote.descriptor.ts's own "signed" status comment
        // above and signatures.service.ts#markSigned.
      },
      {
        id: 'accept-manually',
        label: 'Mark as accepted',
        transitions: ACCEPT_MANUALLY_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(ACCEPT_MANUALLY_TRANSITIONS),
        // The ONE input this action needs - see actions/quote-manual-acceptance.ts's own header for
        // why "required, non-empty, bounded length" is enforced there rather than trusted to this
        // descriptor's own generic 'longText' validator (which only checks the value IS a string, not
        // that it is non-empty - see field-kinds.ts). Declared here anyway, exactly like every other
        // action's own `params`, for the params-defaults endpoint and the OpenAPI schema - the
        // frontend renders its OWN dedicated confirmation dialog for this one action rather than the
        // generic ActionParamsDialog (see `use-document-form.ts`'s own exclusion list, the same one
        // "share-link"/"download-xml" are already on, and `mark-quote-accepted-dialog.tsx`), so this
        // never actually reaches that generic renderer.
        params: [
          {
            key: 'note',
            kind: 'longText',
            label: 'How did the client accept?',
            required: true,
          },
        ],
      },
      {
        id: 'share-link',
        label: 'Share link',
        // See invoice.descriptor.ts's own "share-link" comment for the full
        // reasoning (declared for the country-policy/status gates, served by share-links/ REST
        // routes, never through ActionRegistry). Same three statuses as the invoice's own: a quote
        // still in "draft" has no number and nothing worth handing a stranger a link to.
        availableWhen: ['sending', 'sent', 'send_failed'],
      },
    ],
  };
}

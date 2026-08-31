import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
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
 * quantity, unit price, VAT rate, a per-line discount). Actions: save the draft and send by email
 * (both implemented, see actions/quote-actions.ts — sending a QUOTE by email is this type's own
 * nature, not a mechanism it shares with the invoice, see invoice-actions.ts), convert-to-invoice
 * (implemented, see actions/convert-to-invoice.ts — it used to be the live "declared but not
 * implemented" case this registry proves a 501 against; that role passed to the invoice's
 * "record-payment" next, then to "export-accounting" once "record-payment" was itself implemented —
 * see invoice.descriptor.ts), and request-deposit (implemented, see actions/request-deposit.ts — the
 * minimal, honest replacement for the old, removed "deposit invoice" concept: it creates a brand-new
 * draft INVOICE for N% of this quote's own total, the same "acts on a quote, writes an invoice"
 * shape convert-to-invoice already has, sharing that skeleton via actions/quote-to-invoice.ts).
 *
 * Lifecycle: two statuses, "draft" and "sent" — the only two a quote's own handlers ever write
 * (actions/generic-actions.ts, actions/quote-actions.ts). "save-draft" is faithful to what
 * `registerSaveDraftAction` actually does: it persists "draft" REGARDLESS of the record's current
 * status (even from "sent" — this is the literal, if slightly surprising, behavior the handler
 * already had before this file's own `transitions` existed to name it), hence `from: 'always'`.
 * "send" moves "draft" -> "sent" (registerEmailSendAction). Both `availableWhen`s below are DERIVED
 * from these same transitions (see lifecycle.ts's header) rather than hand-typed a second time.
 * "convert-to-invoice" and "request-deposit" declare NO transition: neither ever changes the QUOTE's
 * own status — each one's entire effect is a brand-new INVOICE elsewhere (convert-to-invoice.ts,
 * request-deposit.ts) — so their `availableWhen` stays its own explicit, hand-declared fact, exactly
 * as it was for "convert-to-invoice" before this cycle mechanism existed.
 *
 * Numbering: `onEnterStatus: 'sent'` — a quote receives its number the first time it leaves "draft",
 * exactly like the old, removed engine numbered at issuance, not at creation (see numbering/ for the
 * full mechanism). "draft" -> "sent" is the ONLY transition this type's own lifecycle has, so this is
 * unambiguous: draft quotes stay unnumbered, however many times they are re-saved.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];

export function buildQuoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'quote',
    label: 'Quote',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sent', label: 'Sent' },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'sent' },
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
    // See contributions/quote-contributions.ts for the implementation — the THIRD real contribution
    // written for this mechanism. Both locations: a draft-quotes shortlist on the dashboard, a
    // "Quotes sent" count plus a fully detailed table on statistics.
    contributions: ['dashboard', 'statistics'],
    // See types.ts's own comment on `listItem`. `client` is the one field a quote cannot exist
    // without (required) and the one a reader actually wants to see first in a list of quotes.
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
            key: 'unitPrice',
            kind: 'money',
            label: 'Unit price',
            required: true,
            min: 0,
            currencyField: 'currency',
          },
          {
            // Même champ que sur la facture (invoice.descriptor.ts) : un devis annonce un prix, et
            // un prix sans son taux de TVA ne dit pas ce que le client paiera. OPTIONNEL ici, là où
            // la facture l'exige : chiffrer sans détailler la taxe reste un devis valable — c'est un
            // choix produit, pas une règle de droit. Découvert par la tâche « totaux » : ses tests
            // posaient un vatRate sur les lignes d'un devis, et le champ n'existait pas.
            key: 'vatRate',
            kind: 'select',
            label: 'VAT rate',
            options: [],
            allowCustomValue: true,
            usesVatRateCatalog: true,
            helpText: 'The VAT rate that applies to this line.',
          },
          {
            // Une remise PAR LIGNE — arithmétique de facturation universelle (elle réduit la base
            // HT avant que la TVA ne s'applique dessus, voir totals/compute-totals.ts), pas une
            // règle fiscale d'un pays en particulier : aucune citation à porter ici, contrairement à
            // `vatRate` ci-dessus dont le TAUX, lui, est bien un fait national. Optionnelle (une
            // ligne sans remise reste la ligne ordinaire d'avant) ; `min`/`max` sont ce qui empêche
            // un -20 % de tourner en majoration de prix côté calcul — voir field-kinds.ts's 'number'
            // validator (numberRangeError), qui s'applique déjà à un sous-champ de 'array' au même
            // titre qu'à n'importe quel champ de premier niveau (validate.ts recurse avec le MÊME
            // registre pour chaque ligne).
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
        availableWhen: ['draft', 'sent'],
      },
      {
        id: 'request-deposit',
        label: 'Request deposit',
        // Only once the quote has actually been SENT — the same reasoning invoice.descriptor.ts's
        // own "record-payment" already holds ("one cannot encash a brouillon"): asking a client for
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
    ],
  };
}

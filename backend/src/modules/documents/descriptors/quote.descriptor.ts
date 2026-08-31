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
 * quantity, unit price). Actions: save the draft and send by email (both implemented, see
 * actions/quote-actions.ts — sending a QUOTE by email is this type's own nature, not a mechanism it
 * shares with the invoice, see invoice-actions.ts) and convert-to-invoice (implemented, see
 * actions/convert-to-invoice.ts — it used to be the live "declared but not implemented" case this
 * registry proves a 501 against; that role now belongs to the invoice's "record-payment", see
 * invoice.descriptor.ts).
 *
 * Lifecycle: two statuses, "draft" and "sent" — the only two a quote's own handlers ever write
 * (actions/generic-actions.ts, actions/quote-actions.ts). "save-draft" is faithful to what
 * `registerSaveDraftAction` actually does: it persists "draft" REGARDLESS of the record's current
 * status (even from "sent" — this is the literal, if slightly surprising, behavior the handler
 * already had before this file's own `transitions` existed to name it), hence `from: 'always'`.
 * "send" moves "draft" -> "sent" (registerEmailSendAction). Both `availableWhen`s below are DERIVED
 * from these same transitions (see lifecycle.ts's header) rather than hand-typed a second time.
 * "convert-to-invoice" declares NO transition: it never changes the QUOTE's own status — its entire
 * effect is a brand-new INVOICE elsewhere (convert-to-invoice.ts) — so `availableWhen` stays its
 * own explicit, hand-declared fact, exactly as it was before this cycle mechanism existed.
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
    ],
  };
}

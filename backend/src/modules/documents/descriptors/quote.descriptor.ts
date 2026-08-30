import { Currency } from '../../../../prisma/generated/prisma/client';
import { DocumentTypeDescriptor } from './types';

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
 */
export function buildQuoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'quote',
    label: 'Quote',
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

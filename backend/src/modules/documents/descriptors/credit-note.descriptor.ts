import { Currency } from '../../../../prisma/generated/prisma/client';
import { DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as the quote's and the invoice's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The credit note ("avoir") document type — the THIRD type written entirely as data, on the model of
 * quote.descriptor.ts and invoice.descriptor.ts. Its purpose here is narrower than being a usable
 * accounting document: it is the type that answers "does the nine-kind core actually hold up", not
 * one more example that happens to fit the same mold as the first two. It describes a FORM. It does
 * NOT encode any rule about what a credit note must legally contain (no forced negative amounts, no
 * required reason code, no link to a specific tax regime) — that would be exactly the kind of legal
 * assertion the removed compliance engine used to own, and this task explicitly asks not to reinvent.
 *
 * Fields:
 *  - `invoice` (reference, entity: 'invoice', REQUIRED) — the invoice this credit note corrects.
 *    SINGLE-target, deliberately NOT the multi-target `entities` mechanism the invoice's own `origin`
 *    field uses (see invoice.descriptor.ts): a credit note only ever corrects an INVOICE — there is
 *    exactly one plausible target type, so `entities: ['invoice']` would be multi-target machinery
 *    wrapped around a set of size one, adding a branch (object-shaped value, `{ entity, id }`) for no
 *    real ambiguity to resolve. `entity: 'invoice'` keeps the stored value a plain id, which is the
 *    right shape when there is truly only one kind of thing on the other end. Required, unlike the
 *    invoice's own optional `origin`: an invoice can exist with no history: a credit note with no
 *    invoice to correct is not a credit note at all — a STRUCTURAL fact about what this type IS, the
 *    same kind of required-ness judgment `lines` already gets on the quote and the invoice, not a
 *    legal one.
 *  - `issueDate`, `currency`, `notes`, `lines` (description/quantity/unitPrice): declared exactly the
 *    way the quote's and the invoice's are — see invoice.descriptor.ts's header on why fields shared
 *    verbatim across types need no new kind.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE GAP THE CORE COULD NOT EXPRESS — flagged, not worked around
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * A real credit note commonly corrects SPECIFIC LINES of the invoice it targets ("this credits line 2
 * of invoice X, not the whole thing"). The nine core field kinds have NO way to express that:
 *  - 'reference' can only point at an entire OTHER document instance (an id) — it cannot pick out one
 *    row inside that instance's own `lines` array.
 *  - 'array' can only describe rows that live INSIDE the current document — it has no notion of
 *    "rows drawn from, or bound to, another document's array field".
 * There is no third kind, and no combination of the two, that lets a descriptor say "let the user
 * choose a subset of ANOTHER document's own line items". The only way to describe "what this credit
 * note covers" with the current core is what this descriptor actually does below: its OWN, entirely
 * separate `lines` array, structurally identical to the invoice's, that merely happens to describe
 * the same kind of thing — free-standing data the user re-enters, not a reference into the invoice's
 * own rows. That is a real information-modeling gap (a credit note's lines cannot be traced back to
 * WHICH invoice line each one corresponds to), not a business rule this file chose to leave out the
 * way invoice.descriptor.ts leaves out a computed total. Closing it would mean a new field kind (or a
 * new capability on 'array'/'reference') for "a selection of rows belonging to another document
 * instance" — deliberately NOT invented here, per the instruction not to smuggle in a fix quietly.
 *
 * Actions: "save-draft" only — implemented, the exact same generic mechanism every document type
 * here shares (actions/generic-actions.ts). Nothing else was asked for this type ("au minimum
 * enregistrer le brouillon"), so nothing else is declared: a "send" or a status-changing action here
 * would mean inventing policy (who does a credit note go to? does it need its own transport?) that
 * was never part of this task.
 */
export function buildCreditNoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'credit-note',
    label: 'Credit note',
    fields: [
      {
        key: 'invoice',
        kind: 'reference',
        label: 'Invoice',
        required: true,
        entity: 'invoice',
        helpText: 'The invoice this credit note corrects.',
      },
      {
        key: 'issueDate',
        kind: 'date',
        label: 'Date',
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
    ],
  };
}

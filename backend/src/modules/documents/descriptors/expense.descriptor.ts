import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as every other document type's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — a fixed list, WITH an "Other" catch-all
 * value, not a per-company configurable one: no mechanism for a company to define its OWN list of
 * values exists anywhere in this codebase today (checked — `payment-methods/` is the closest
 * precedent, but it is a registry of built-in TYPES a company enables/configures, never a company
 * writing its own free-form list; rank 15, "champs personnalisés / tags", is exactly the still-
 * unbuilt mechanism that WOULD let a company do that generically). Building a per-company category
 * editor is real, separate work this rank's own scope does not cover — flagged in this feature's own
 * report as a product choice to validate, not a researched, closed list the way `vat-rates/`'s own
 * catalogs are. `'other'` is a plain option INSIDE this closed list (never `allowCustomValue` — see
 * field-kinds.ts's own 'select' validator: that escape hatch only ever opens for an EMPTY options
 * list, which this one deliberately is not), so a scripted client is refused exactly what the screen
 * offers, same as every other 'select' field here.
 */
const EXPENSE_CATEGORY_OPTIONS = [
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals & entertainment' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'office_supplies', label: 'Office supplies' },
  { value: 'software', label: 'Software & subscriptions' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'professional_services', label: 'Professional services' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'other', label: 'Other' },
];

/**
 * The expense document type — the FOURTH type written entirely as data, and the first one that used
 * to be its OWN bespoke module (`modules/expenses/`, a plain Controller/Service/Prisma-model CRUD
 * resource, now removed) rather than a fresh addition. Migrating it here is exactly the "a country
 * is data, a document type is a descriptor" discipline applied to something that predates this
 * branch's own document model — see the migration itself (prisma/migrations/…_migrate_expenses…)
 * for how the OLD `Expense` table's rows became `DocumentInstance` rows with `typeId: "expense"`.
 *
 * Fields were originally a 1:1 carry-over of the old `CreateExpenseDto`/`EditExpenseDto`
 * (the removed expense module's own service): description, amount, currency, date, notes.
 *
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") added four more, all `required: false` (an
 * expense with none of them is exactly as valid a record as before this rank existed — the same
 * "enrichment, never a new requirement" posture `received-invoice.descriptor.ts`'s own optional
 * fields already hold):
 *  - `attachment` (kind 'file', the 12th core field kind — see descriptors/types.ts's own header):
 *    a photo or PDF of the receipt. Storage is REUSED, not duplicated —
 *    `attachments/attachments.service.ts` reuses `received-invoices/storage.ts`'s own content-hash-
 *    addressed, `DOCUMENTS_INBOUND_DIR`-rooted persistence (the same volume-backed directory that
 *    already survives a `docker pull`), never a second storage mechanism invented for this type.
 *  - `category` (kind 'select', `EXPENSE_CATEGORY_OPTIONS` above) — see that constant's own header
 *    for why this is a fixed list with an "Other" value, not a per-company configurable one.
 *  - `distanceKm`/`ratePerKm` ("kilométrage") — plain, INFORMATIONAL optional numeric fields, a
 *    distance and a rate the USER TYPES IN, exactly like `vat-rates/`'s own catalog is "the seller's
 *    own sourced rate, not a tax authority" — nothing here sources a legal mileage scale (a
 *    per-country fiscal barème is legally sourced data, e.g. France's own barème kilométrique
 *    published yearly by the tax authority, and is deliberately OUT of this rank's scope — see this
 *    feature's own report). Deliberately NOT auto-multiplied into `amount`: no generic
 *    "derive field X from Y × Z" mechanism exists in this descriptor model (compute-totals.ts's own
 *    generic arithmetic only ever recognizes an 'array' field carrying a money+number PAIR inside
 *    each ROW, e.g. `quantity`×`unitPrice` — see expense-contributions.ts's own header on why THIS
 *    type's flat `amount` cannot reuse that helper either), and inventing a second, single-purpose
 *    one for two flat top-level fields would be exactly the kind of speculative, single-consumer
 *    machinery this codebase avoids (field-kinds.ts's own closed `CORE_FIELD_KINDS`). The user still
 *    types the resulting total into `amount` themselves, same as always.
 *
 * Actions: "save-draft" (the same generic mechanism every type here shares) and "delete" — the FIRST
 * use of the new generic "delete" (generic-actions.ts's registerDeleteAction). An expense is
 * bookkeeping housekeeping a user can freely remove if mis-entered; see registerDeleteAction's own
 * comment for why this is deliberately NOT extended to the quote/invoice/credit-note. There is no
 * "send" here at all: the old module never had one either (an expense was never transmitted
 * anywhere), so none is invented now.
 *
 * Lifecycle: a SINGLE status, "draft" — the only one "save-draft" (generic-actions.ts's
 * registerSaveDraftAction) ever writes, from any current status (`from: 'always'`, trivially true
 * here since "draft" is the only status this type's own lifecycle has ever reached). "delete"
 * declares NO transition: the record is removed entirely, never transitioned to another status.
 *
 * Numbering: NOT declared — see types.ts's own comment on `DocumentTypeDescriptor.numbering`. An
 * expense is an internal bookkeeping entry a company records for itself, never a document handed to
 * a third party the way a quote/invoice/credit-note is; nothing about it needs a display number, and
 * (same structural reason as credit-note.descriptor.ts) it has no non-"draft" status to hook one onto
 * even if it did. `expense` never appearing in numbering/sequence.ts's `DocumentNumberSequence` table
 * is this descriptor's own doing, not an oversight elsewhere: `takeDocumentNumberForTransition` is
 * only ever called by documents.service.ts's `runAction` when `descriptor.numbering` is present.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];

export function buildExpenseDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'expense',
    label: 'Expense',
    statuses: [{ id: 'draft', label: 'Draft' }],
    initialStatus: 'draft',
    // See types.ts's own comment on `DocumentTypeDescriptor.email` — declared for the same
    // consistency reason as credit-note.descriptor.ts's own: this type has no "send" action and
    // never will (see this file's own header — an expense is never transmitted anywhere), but a
    // company overriding `documentEmailTemplates` for every type ahead of any one of them actually
    // sending gets a sober default here too, not a hole. No `{recipientName}`, no `{totalGross}` —
    // this type has no 'reference' field targeting "client" and no line-array totals computation
    // (compute-totals.ts finds no money+number 'array' field on it) to format one from.
    email: {
      subject: '{typeLabel} {displayNumber}',
      body: 'Please find attached {typeLabel} {displayNumber} from {companyName}.',
    },
    // See contributions/expense-contributions.ts for the implementation — the SECOND real
    // contribution written for this mechanism, calqued on invoice-contributions.ts. Both locations:
    // a "this month" metric on the dashboard, a fully detailed table on statistics.
    contributions: ['dashboard', 'statistics'],
    // See types.ts's own comment on `listItem`. An expense has no relation field to lead with (no
    // client, no source document) — `description` is its own required, human-written identifier.
    listItem: {
      titleFields: ['description'],
      secondaryFields: ['amount', 'date', 'category'],
    },
    fields: [
      {
        key: 'description',
        kind: 'text',
        label: 'Description',
        required: true,
      },
      {
        key: 'amount',
        kind: 'money',
        label: 'Amount',
        required: true,
        min: 0,
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
        key: 'date',
        kind: 'date',
        label: 'Date',
        required: true,
      },
      {
        key: 'category',
        kind: 'select',
        label: 'Category',
        required: false,
        options: EXPENSE_CATEGORY_OPTIONS,
      },
      {
        key: 'attachment',
        kind: 'file',
        label: 'Receipt',
        required: false,
        helpText: 'A photo or PDF of the receipt.',
      },
      {
        key: 'distanceKm',
        kind: 'number',
        label: 'Distance (km)',
        required: false,
        min: 0,
        helpText: 'Optional, informational — this app does not apply a per-country mileage rate.',
      },
      {
        key: 'ratePerKm',
        kind: 'money',
        label: 'Rate per km',
        required: false,
        min: 0,
        currencyField: 'currency',
        helpText: 'Your own rate — multiply by the distance yourself into "Amount" above.',
      },
      {
        key: 'notes',
        kind: 'longText',
        label: 'Notes',
        required: false,
      },
    ],
    actions: [
      {
        id: 'save-draft',
        label: 'Save',
        transitions: SAVE_DRAFT_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SAVE_DRAFT_TRANSITIONS),
      },
      {
        id: 'delete',
        label: 'Delete',
        // NOT 'always': a brand-new, never-saved draft has nothing to delete yet (there is no
        // documentId for the handler to act on) — offering the button before the first "Save"
        // would let a user click it into the handler's "unreachable in practice" guard
        // (generic-actions.ts's registerDeleteAction), which is a plain Error, not a clean 4xx.
        // Restricting to 'draft' (the only status this type's lifecycle ever reaches) keeps the
        // button gone until there is a saved record for it to act on, the same as any other action
        // here that needs an existing record.
        availableWhen: ['draft'],
      },
    ],
  };
}

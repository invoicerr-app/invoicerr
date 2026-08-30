import { Currency } from '../../../../prisma/generated/prisma/client';
import { DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as every other document type's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The expense document type — the FOURTH type written entirely as data, and the first one that used
 * to be its OWN bespoke module (`modules/expenses/`, a plain Controller/Service/Prisma-model CRUD
 * resource, now removed) rather than a fresh addition. Migrating it here is exactly the "a country
 * is data, a document type is a descriptor" discipline applied to something that predates this
 * branch's own document model — see the migration itself (prisma/migrations/…_migrate_expenses…)
 * for how the OLD `Expense` table's rows became `DocumentInstance` rows with `typeId: "expense"`.
 *
 * Fields are a 1:1 carry-over of the old `CreateExpenseDto`/`EditExpenseDto`
 * (modules/expenses/expenses.service.ts, removed): description, amount, currency, date, notes. No
 * field kind needed to grow to describe it — same outcome invoice.descriptor.ts's header already
 * states for the invoice.
 *
 * Actions: "save-draft" (the same generic mechanism every type here shares) and "delete" — the FIRST
 * use of the new generic "delete" (generic-actions.ts's registerDeleteAction). An expense is
 * bookkeeping housekeeping a user can freely remove if mis-entered; see registerDeleteAction's own
 * comment for why this is deliberately NOT extended to the quote/invoice/credit-note. There is no
 * "send" here at all: the old module never had one either (an expense was never transmitted
 * anywhere), so none is invented now.
 */
export function buildExpenseDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'expense',
    label: 'Expense',
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
        availableWhen: 'always',
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

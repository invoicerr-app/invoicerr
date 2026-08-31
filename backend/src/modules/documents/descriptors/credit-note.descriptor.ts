import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as the quote's and the invoice's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The credit note ("avoir") document type — the THIRD type written entirely as data, on the model of
 * quote.descriptor.ts and invoice.descriptor.ts. Its purpose here is narrower than being a usable
 * accounting document: it is the type that answers "does the core actually hold up", not one more
 * example that happens to fit the same mold as the first two. It describes a FORM. It does NOT encode
 * any rule about what a credit note must legally contain (no forced negative amounts, no required
 * reason code, no link to a specific tax regime) — that would be exactly the kind of legal assertion
 * the removed compliance engine used to own, and this task explicitly asks not to reinvent.
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
 *    same kind of required-ness judgment `correctedLines` already gets below, not a legal one.
 *  - `issueDate`, `currency`, `notes`: declared exactly the way the quote's and the invoice's are —
 *    see invoice.descriptor.ts's header on why fields shared verbatim across types need no new kind.
 *  - `correctedLines` (kind: 'rowSelection', REQUIRED, min: 1) — WHICH of `invoice`'s own `lines` this
 *    credit note corrects. This used to be a free-standing `lines` array the user re-entered from
 *    scratch, structurally identical to the invoice's but with no traceable link back to which invoice
 *    line each row actually corresponded to — a real information-modeling gap the core had no kind to
 *    close (a document commonly needs to point at a SUBSET of another document's own rows; neither
 *    'reference', which only resolves to a whole document, nor 'array', which only describes rows
 *    living in the CURRENT document, could say that). `rowSelection` (row-selection/row-selection.ts)
 *    is the 10th core kind that closes it, generically — this is only its first USE, not something
 *    built for this type alone; nothing here is specific to a credit note beyond the three hints below
 *    naming which sibling field, which entity, and which array they point at.
 *
 * Actions: "save-draft" only — implemented, the exact same generic mechanism every document type here
 * shares (actions/generic-actions.ts). Nothing else was asked for this type ("au minimum enregistrer
 * le brouillon"), so nothing else is declared: a "send" or a status-changing action here would mean
 * inventing policy (who does a credit note go to? does it need its own transport?) that was never part
 * of this task.
 *
 * Lifecycle: a SINGLE status, "draft" — the only one "save-draft" (generic-actions.ts's
 * registerSaveDraftAction) ever writes, from any current status (`from: 'always'`, trivially true
 * here since "draft" is the only status this type's own lifecycle has ever reached). No second
 * status is invented: nothing asked for one, and no handler produces one.
 *
 * Numbering: NOT declared, despite a real credit note plausibly needing one in actual bookkeeping —
 * see types.ts's own comment on `numbering`. `numbering.onEnterStatus` must name one of THIS type's
 * own declared `statuses` (checked by `validateLifecycle`, lifecycle.ts), and this type has only
 * "draft" — there is no non-draft status to hook a number onto, because there is no "send" (or any
 * other status-changing) action here at all (see the "Actions" paragraph above). Tried and verified,
 * not merely asserted: declaring `numbering: { onEnterStatus: 'sent' }` here throws at registration
 * with `validateLifecycle`'s own "not one of its own declared statuses" error, exactly like a typo'd
 * status would for `initialStatus`. Adding a "sent"-like status (and the action that would reach it)
 * purely to make this type numberable would be inventing lifecycle this task never asked for — see
 * this file's own "Actions" paragraph on the same restraint for a "send" action itself.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];

export function buildCreditNoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'credit-note',
    label: 'Credit note',
    statuses: [{ id: 'draft', label: 'Draft' }],
    initialStatus: 'draft',
    // See types.ts's own comment on `DocumentTypeDescriptor.email` — declared for consistency with
    // every other shipped type, even though this type has no "send" action yet (see this file's own
    // "Actions" paragraph above): a future send mechanism, or a company that overrides
    // `documentEmailTemplates` ahead of one existing, gets a sober default rather than a hole. No
    // `{recipientName}` here — this type has no field targeting the "client" entity (only
    // `invoice`), so that placeholder is deliberately left out of this type's OWN default (a company
    // override that adds it anyway degrades honestly — see actions/email-template.ts).
    email: {
      subject: '{typeLabel} {displayNumber} from {companyName}',
      body:
        'Please find attached {typeLabel} {displayNumber} from {companyName}, for a total of ' +
        '{totalGross}.\n\n' +
        'Best regards,\n{companyName}',
    },
    // See types.ts's own comment on `listItem`. `invoice` is required and is what a credit note
    // IS relative to (the invoice it corrects) — the natural heading for a list of credit notes.
    listItem: {
      titleFields: ['invoice'],
      secondaryFields: ['issueDate', 'currency'],
    },
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
        key: 'correctedLines',
        kind: 'rowSelection',
        label: 'Corrected lines',
        required: true,
        min: 1,
        helpText: 'The lines of the invoice above that this credit note corrects.',
        sourceField: 'invoice',
        sourceEntity: 'invoice',
        sourceArrayField: 'lines',
      },
    ],
    actions: [
      {
        id: 'save-draft',
        label: 'Save draft',
        transitions: SAVE_DRAFT_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SAVE_DRAFT_TRANSITIONS),
      },
    ],
  };
}

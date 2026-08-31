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
 * Actions: "save-draft", the exact same generic mechanism every document type here shares
 * (actions/generic-actions.ts) — plus, as of item 8 of the root TODO ("le lettrage"), "send"
 * (actions/credit-note-actions.ts): a plain STATUS transition that reads and writes NOTHING beyond
 * that status — no transport, no email, no recipient. This is deliberately NOT the quote's
 * `registerEmailSendAction`/`registerEmailRecipientDefaultFromClient` mechanism, and NOT the
 * invoice's own company-configured-transport one either: this type still has no "client" field (see
 * the `invoice` field's own comment above) and still no declared opinion on WHO a credit note goes to
 * or THROUGH WHICH channel — exactly the policy this file's own history already refused to invent for
 * "au minimum enregistrer le brouillon". What changed is narrower than that: a credit note only
 * REDUCES what the invoice it corrects still owes once it is no longer a draft (settlement/credits.ts
 * — a draft is a document the user has not finished, and settles nothing), so SOME way to leave
 * "draft" had to exist for lettrage to mean anything at all. "send" is that minimal mechanism, and
 * nothing more: it does not attempt delivery, and reusing this name (rather than, say, "issue") keeps
 * it the same verb the frontend already renders a button for on every other type (quote, invoice).
 *
 * As of TODO.md item 22, "send" ALSO goes through the same asynchronous two-phase shape the quote's
 * and the invoice's own do (actions/async-send.ts) — even though this type's own `deliver()`
 * (credit-note-actions.ts) does nothing at all (no transport, no email — see above). This is
 * deliberate, not an oversight: a "send" that is not asynchronous would be a SECOND declared shape for
 * the same action id, and the whole point of `actions/async-send.ts` existing is that every type with
 * a "send" shares ONE mechanism, whatever `deliver()` itself actually does. In practice the "sending"
 * status is near-instantaneous here (there is nothing to await), but it is not skipped.
 *
 * Lifecycle: FOUR statuses now — "draft", "sending", "sent", "send_failed" — the same shape
 * quote.descriptor.ts's own lifecycle paragraph documents in full. "save-draft"
 * (generic-actions.ts's registerSaveDraftAction) always persists "draft", from ANY current status
 * (`from: 'always'`, faithful to what the handler actually does); "send" (credit-note-actions.ts) has
 * the same two transition entries as the quote's and the invoice's own: "draft"/"send_failed" ->
 * "sending", then "sending" -> "sent" OR "send_failed".
 *
 * Numbering: still NOT declared — see types.ts's own comment on `numbering`. Whether an ISSUED credit
 * note needs a legal, sequential number of its own is a real question for actual French bookkeeping,
 * but it is a DIFFERENT task from lettrage: item 8 asks that a sent credit note reduce what its
 * invoice owes, not that it be numbered. Adding `numbering` here would be exactly the kind of
 * unrequested scope this file's own header already declines elsewhere (no forced negative amounts, no
 * required reason code) — left for whichever task actually asks for it, not guessed at here.
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];

export function buildCreditNoteDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'credit-note',
    label: 'Credit note',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      { id: 'sent', label: 'Sent' },
      { id: 'send_failed', label: 'Send failed' },
    ],
    initialStatus: 'draft',
    // See types.ts's own comment on `DocumentTypeDescriptor.email` — declared for consistency with
    // every other shipped type, even though this type's own "send" (see this file's own "Actions"
    // paragraph above) never actually reads it: it is a plain status transition, not an email
    // dispatch (unlike the quote's/invoice's own "send"). A future mechanism that DOES deliver a
    // credit note by mail, or a company that overrides `documentEmailTemplates` ahead of one
    // existing, gets a sober default rather than a hole. No `{recipientName}` here — this type has no
    // field targeting the "client" entity (only `invoice`), so that placeholder is deliberately left
    // out of this type's OWN default (a company override that adds it anyway degrades honestly — see
    // actions/email-template.ts).
    email: {
      subject: '{typeLabel} {displayNumber} from {companyName}',
      body:
        'Please find attached {typeLabel} {displayNumber} from {companyName}, for a total of ' +
        '{totalGross}.\n\n' +
        'Best regards,\n{companyName}',
    },
    // See contributions/credit-note-contributions.ts for the implementation, and its own header for
    // why 'statistics' ONLY — deliberately no 'dashboard' entry here: a credit note is rare, and a
    // dashboard widget that is empty nearly every time someone looks is noise, not information.
    contributions: ['statistics'],
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
      {
        id: 'send',
        label: 'Send',
        transitions: SEND_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SEND_TRANSITIONS),
        // No params — see this file's own "Actions" paragraph: this is a plain status transition,
        // not a delivery, so there is no recipient (or anything else) to type in here.
      },
    ],
  };
}

import { Currency } from '../../../../prisma/generated/prisma/client';
import { transitionsAvailableWhen } from './lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** Same reused, un-invented list as the quote's and the invoice's — see quote.descriptor.ts. */
const CURRENCY_OPTIONS = Object.values(Currency).map((code) => ({ value: code, label: code }));

/**
 * The credit note document type — the THIRD type written entirely as data, on the model of
 * quote.descriptor.ts and invoice.descriptor.ts. Its purpose here is narrower than being a usable
 * accounting document: it is the type that answers "does the core actually hold up", not one more
 * example that happens to fit the same mold as the first two. It describes a FORM. It does NOT encode
 * any rule about what a credit note must legally contain (no forced negative amounts, no link to a
 * specific tax regime) — that would be exactly the kind of legal assertion the removed compliance
 * engine used to own, and which is deliberately not reinvented here.
 *
 * ## Two shapes, one type: LINKED and FREE
 * A credit note either corrects an invoice, or it does not — a commercial gesture, a refund of an
 * overpayment nobody ever tied to one invoice line, nothing to "correct" at all. Both are the SAME
 * document type (same statuses, same actions, same PDF); the `invoice` field is what forks the two:
 *  - `invoice` (reference, entity: 'invoice', OPTIONAL) — the invoice this credit note corrects, when
 *    it corrects one at all. SINGLE-target, deliberately NOT the multi-target `entities` mechanism the
 *    invoice's own `origin` field uses (see invoice.descriptor.ts): a credit note only ever corrects an
 *    INVOICE — there is exactly one plausible target type, so `entities: ['invoice']` would be
 *    multi-target machinery wrapped around a set of size one, adding a branch (object-shaped value,
 *    `{ entity, id }`) for no real ambiguity to resolve. `entity: 'invoice'` keeps the stored value a
 *    plain id, which is the right shape when there is truly only one kind of thing on the other end.
 *    OPTIONAL, unlike the invoice's own optional `origin`-for-a-different-reason: leaving it unset is
 *    not a data gap here, it is the FREE credit note itself — the fork this whole header describes.
 *  - `correctedLines` (kind: 'rowSelection', `requiredIfPresent: 'invoice'`) — WHICH of
 *    `invoice`'s own `lines` this credit note corrects, once it corrects one at all. This used to be a
 *    free-standing `lines` array the user re-entered from scratch, structurally identical to the
 *    invoice's but with no traceable link back to which invoice line each row actually corresponded to
 *    — a real information-modeling gap the core had no kind to close (a document commonly needs to
 *    point at a SUBSET of another document's own rows; neither 'reference', which only resolves to a
 *    whole document, nor 'array', which only describes rows living in the CURRENT document, could say
 *    that). `rowSelection` (row-selection/row-selection.ts) is the 10th core kind that closes it,
 *    generically — this is only its first USE, not something built for this type alone; nothing here
 *    is specific to a credit note beyond the three hints below naming which sibling field, which
 *    entity, and which array they point at. `requiredIfPresent: 'invoice'` (not unconditional
 *    `required`) is what lets a FREE credit note leave this empty: there is nothing to select rows
 *    from when there is no `invoice` to select them off of. No descriptor-level `min` either, for the
 *    identical reason `lines` (below) has none — see `assertCreditNoteAmountSourceIsUnambiguous`'s
 *    own header (credit-note-actions.ts) for why "at least one, once linked" moved to an explicit
 *    action guard.
 *  - `lines` (kind: 'array', NOT required at the descriptor level — see `assertCreditNoteAmountSourceIsUnambiguous`,
 *    credit-note-actions.ts) — a FREE credit note's own table of amounts, shaped exactly like the
 *    invoice's own line item (description/quantity/unit price/VAT rate — see invoice.descriptor.ts's
 *    "The line shape" for why these four), because it needs to price something with no invoice line to
 *    point at instead. Left with no descriptor-level `min`: an unconditional `min: 1` here would break
 *    the LINKED shape (whose `lines` value is always `[]` — everything it prices lives in
 *    `correctedLines` instead), so "at least one line once there is no invoice" is a business rule
 *    enforced explicitly by `assertCreditNoteAmountSourceIsUnambiguous`, the same "declarative where
 *    it can be, explicit where it must be" split `assertCreditNoteCurrencyMatchesInvoice` already
 *    uses. Declaring this as a plain 'array' field (not a bespoke "amount" mechanism) is also what
 *    makes `totals/compute-totals.ts` price a FREE credit note for free: that function already finds
 *    any 'array' field with a 'money' and a 'number' subfield and sums it — a LINKED credit note's own
 *    amount still comes from `correctedLines` alone (settlement/credits.ts's own
 *    `computeCreditedAmountMinor`, a deliberately separate calculation — see that file's own header),
 *    unaffected either way.
 *  - `reason` (kind: 'longText', `requiredIfAbsent: 'invoice'`) — why this credit note exists.
 *    Mandatory the moment there is no `invoice` to correct (a FREE credit note is, by construction, an
 *    unexplained deduction unless something says why), optional once one is set (the correction
 *    itself — which invoice, which lines — already says what this document is for; forcing a second,
 *    redundant explanation on every linked credit note would be exactly the kind of unrequested legal
 *    assertion this file's own header already declines to invent). This is a PRODUCT choice about
 *    what THIS SCREEN requires before saving, the same "required on this screen, not a legal
 *    requirement this repo is asserting" distinction `country-fields/data/pl.json`'s own
 *    `correctionReason` (on the INVOICE type, for Poland's `correctsInvoiceId`) already draws — see
 *    that file's own header. `requiredIfAbsent` (descriptors/types.ts) is the mirror image of the
 *    `requiredIfPresent` hint that field already uses.
 *  - `issueDate`, `currency`, `notes`: declared exactly the way the quote's and the invoice's are —
 *    see invoice.descriptor.ts's header on why fields shared verbatim across types need no new kind.
 *
 * ## A FREE credit note is not legal everywhere
 * Whether a seller's own country recognises a credit note with nothing to reference is a REAL legal
 * question, not a product preference — and the answer is not uniform. Poland's own `ustawa o VAT` (art.
 * 106j ust. 1) gives a seller-issued reduction NO instrument of its own: the SAME referenced document,
 * the faktura korygująca, covers both an increase and a decrease, and the FA(3) `RodzajFaktury`
 * enumeration this repo already reads (`formats/national/fa3-provider.ts`) has no "avoir"/"nota
 * kredytowa" type at all (`correction-routes/data/pl.json`'s own CREDIT_NOTE fact, status
 * `'forbidden'`, sourced). A FREE credit note for a Polish seller is therefore not a lesser version of
 * that document, it has no legal basis to exist AT ALL — `credit-note-actions.ts`'s own
 * `assertFreeCreditNoteAllowedForCountry` reads that exact fact (never a second, invented one) and
 * refuses outright, naming the country and quoting the catalog's own citation. FR/DE/IT/PT each keep
 * their own CREDIT_NOTE route `'allowed'` — a credit note is a document in its own right there, with no
 * legal requirement that it reference an original invoice — so a Free credit note is unblocked for
 * them; this is COUNTRY DATA, read at save time, never a hardcoded country list here.
 *
 * ## Actions
 * "save-draft" was, until the currency guard, the exact same generic mechanism every
 * document type here shares (actions/generic-actions.ts's `performSaveDraft`) — it now goes through
 * `credit-note-actions.ts`'s own `registerCreditNoteSaveDraftAction`, which wraps that same
 * persistence with THREE guards: the amount-source guard (linked XOR free, never both, and a free one
 * needs at least one line), the country guard (`assertFreeCreditNoteAllowedForCountry`, above), and
 * the currency guard (the currency declared here must equal the `invoice` field's own, once one is
 * set — see that function's own header for the full "why", and this file's own `currency` field for
 * the SCREEN-side half of the same rule, `lockedFromReference`). Plus, for credit matching, "send"
 * (actions/credit-note-actions.ts): a plain STATUS transition that reads and writes NOTHING beyond
 * that status — no transport, no email, no recipient. This is deliberately NOT the quote's
 * `registerEmailSendAction`/`registerEmailRecipientDefaultFromClient` mechanism, and NOT the
 * invoice's own company-configured-transport one either: this type still has no "client" field (see
 * the `invoice` field's own comment above) and still no declared opinion on WHO a credit note goes to
 * or THROUGH WHICH channel — exactly the policy this file's own history already refused to invent for
 * "at minimum save the draft". What changed is narrower than that: a credit note only
 * REDUCES what the invoice it corrects still owes once it is no longer a draft (settlement/credits.ts
 * — a draft is a document the user has not finished, and settles nothing), so SOME way to leave
 * "draft" had to exist for credit matching to mean anything at all. "send" is that minimal mechanism, and
 * nothing more: it does not attempt delivery, and reusing this name (rather than, say, "issue") keeps
 * it the same verb the frontend already renders a button for on every other type (quote, invoice). A
 * FREE credit note settles nothing (settlement/credits.ts only ever resolves credits FOR an invoice —
 * a note with no `invoice` simply never matches one), so "send" for one is nothing more than the
 * status flip itself, with no settlement side effect to speak of either.
 *
 * "send" ALSO goes through the same asynchronous two-phase shape the quote's
 * and the invoice's own do (actions/async-send.ts) — even though this type's own `deliver()`
 * (credit-note-actions.ts) does nothing at all (no transport, no email — see above). This is
 * deliberate, not an oversight: a "send" that is not asynchronous would be a SECOND declared shape for
 * the same action id, and the whole point of `actions/async-send.ts` existing is that every type with
 * a "send" shares ONE mechanism, whatever `deliver()` itself actually does. In practice the "sending"
 * status is near-instantaneous here (there is nothing to await), but it is not skipped.
 *
 * Lifecycle: FOUR statuses now — "draft", "sending", "sent", "send_failed" — the same shape
 * quote.descriptor.ts's own lifecycle paragraph documents in full. "save-draft"
 * (credit-note-actions.ts's registerCreditNoteSaveDraftAction, wrapping generic-actions.ts's
 * performSaveDraft) always persists "draft", from ANY current status (`from: 'always'`, faithful to
 * what the handler actually does — the guards above can only BLOCK that persist, never
 * change the declared transition itself); "send" (credit-note-actions.ts) has
 * the same two transition entries as the quote's and the invoice's own: "draft"/"send_failed" ->
 * "sending", then "sending" -> "sent" OR "send_failed".
 *
 * Numbering: still NOT declared — see types.ts's own comment on `numbering`. Whether an ISSUED credit
 * note needs a legal, sequential number of its own is a real question for actual French bookkeeping,
 * but it is a DIFFERENT concern from credit matching: credit matching asks that a sent credit note reduce what its
 * invoice owes, not that it be numbered. Adding `numbering` here would be exactly the kind of
 * unrequested scope this file's own header already declines elsewhere (no forced negative amounts) —
 * left for whichever need actually calls for it, not guessed at here; the FREE shape above does not
 * change that judgment either.
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
      // `clientVisible` — see `DocumentStatusDescriptor`'s own header. A credit note has no `client`
      // field of its own (only `invoice`, above) — the client portal resolves which client a credit
      // note belongs to through the invoice it corrects, the same join
      // `settlement/credits.ts#creditsForInvoiceFromNotes` already performs for the statement. A FREE
      // credit note (no `invoice`) resolves to no client at all and is simply never shown there — see
      // that same join, which only ever matches a note against ONE named invoice id.
      { id: 'sent', label: 'Sent', clientVisible: true },
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
    // See types.ts's own comment on `listItem`. `invoice` is what a credit note corrects when it
    // corrects one — still the natural heading for a list of credit notes even now that it is
    // optional: `render-html.ts`/`document-list.tsx`'s own generic "field is absent" rendering already
    // shows a FREE credit note's row honestly (no invoice named), never a crash or a blank heading.
    listItem: {
      titleFields: ['invoice'],
      secondaryFields: ['issueDate', 'currency'],
    },
    fields: [
      {
        key: 'invoice',
        kind: 'reference',
        label: 'Invoice',
        required: false,
        entity: 'invoice',
        helpText:
          'The invoice this credit note corrects. Leave empty for a FREE credit note (a commercial ' +
          'gesture, a refund of an overpayment) — a reason is then required below, and some countries ' +
          'do not recognise a credit note with nothing to reference (this screen refuses those with ' +
          "the country's own rule once you try to save).",
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
        // A LINKED credit note has no business declaring a currency other than the
        // invoice it corrects: the amount it credits is structurally denominated in that invoice's
        // OWN currency (settlement/credits.ts's own header, and the "no conversion for
        // credit notes" finding). Locks this field's value to whatever `currency` the picked `invoice`
        // resolves to — see types.ts's own `lockedFromReference` header for the full mechanism, and
        // credit-note-actions.ts's own header for the SERVER-SIDE hard block this screen convenience
        // is backed by (never a substitute for it). A FREE credit note (no `invoice` picked) has
        // nothing to lock against — `lockedFromReference` is a no-op until its own sibling field
        // resolves, so this stays a normal, user-chosen currency in that case, on both sides.
        lockedFromReference: { field: 'invoice', entity: 'invoice', sourceKey: 'currency' },
      },
      {
        key: 'notes',
        kind: 'longText',
        label: 'Notes',
        required: false,
      },
      {
        key: 'reason',
        kind: 'longText',
        label: 'Reason',
        requiredIfAbsent: 'invoice',
        helpText:
          'Why this credit note exists — required once there is no invoice to correct (a FREE credit ' +
          'note). Optional once one is set: the correction itself already says what this document is for.',
      },
      {
        key: 'correctedLines',
        kind: 'rowSelection',
        label: 'Corrected lines',
        requiredIfPresent: 'invoice',
        // No `min` here — see credit-note-actions.ts#assertCreditNoteAmountSourceIsUnambiguous's own
        // header for why the "at least one, once linked" floor moved to an explicit action guard
        // instead of a static bound that would also fire on a genuinely empty FREE note.
        helpText: 'The lines of the invoice above that this credit note corrects.',
        sourceField: 'invoice',
        sourceEntity: 'invoice',
        sourceArrayField: 'lines',
      },
      {
        key: 'lines',
        kind: 'array',
        label: 'Lines',
        required: false,
        // See this file's own header, "Two shapes, one type", for why this deliberately carries no
        // `min` here despite a FREE credit note needing at least one row — that floor is enforced by
        // `credit-note-actions.ts#assertCreditNoteAmountSourceIsUnambiguous`, not this descriptor.
        helpText:
          'Free-amount lines for a credit note that corrects no particular invoice — quantity × unit ' +
          'price × VAT rate, exactly like an invoice\'s own lines. Leave empty once "Invoice" is set; ' +
          'use "Corrected lines" instead.',
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
            // See invoice.descriptor.ts's own `lines.vatRate` comment — same catalog, same convention,
            // filled per company by descriptors/company-view.ts, never here.
            key: 'vatRate',
            kind: 'select',
            label: 'VAT rate',
            required: true,
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
        // No params — see this file's own "Actions" paragraph: this is a plain status transition,
        // not a delivery, so there is no recipient (or anything else) to type in here.
      },
      {
        id: 'share-link',
        label: 'Share link',
        // See invoice.descriptor.ts's own "share-link" comment for the full
        // reasoning. This type has no `numbering` declared at all (this file's own header, above),
        // so "available once numbered" doesn't apply here the way it does for the invoice/quote —
        // the gate that matters is simply "not a draft any more", the same status set anyway.
        availableWhen: ['sending', 'sent', 'send_failed'],
      },
    ],
  };
}

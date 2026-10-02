import { BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { resolveCorrectionRoutesForCountry } from '../correction-routes/correction-routes';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { resolveCreditNoteDeliverySource } from '../formats/credit-note-source';
import { findOwnedDocument } from '../persistence';
import { DocumentEventPublisher } from '../queue/document-events';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { computeSettlement } from '../settlement/compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from '../settlement/credits';
import { crossedIntoSettled, emitDocumentSettled } from '../settlement/document-settled';
import { listPayments, toSettlementPaymentInputs } from '../settlement/payments';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { renderDocumentInstance } from '../rendering/render-instance-pdf';
import { NullSigningCredentials, SigningCredentialsPort } from '../signing/signing-credentials-port';
import { signRenderedPdfIfConfigured } from '../signing/sign-instance-pdf';
import { decrementsStockOnIssuance } from '../stock/apply-stock-on-issuance';
import { computeDocumentTotals } from '../totals/compute-totals';
import { TransportFormatSource, TransportRegistry } from '../transports/transport-registry';
import { ArchivedArtifactInput } from '../archive/hashing';
import { runAsyncSendAction } from './async-send';
import { attachAtcudToNumberedDocument, runAtcudPreflight } from './atcud-issuance';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';
import { performSaveDraft } from './generic-actions';
import {
  ResolvedInvoiceTransport,
  resolveInvoiceTransport,
  runInvoiceSendPreflight,
} from './invoice-actions';

/** Same direct-import model as actions/invoice-actions.ts's own `INVOICE_DESCRIPTOR` constant — used
 *  ONLY to feed `computeDocumentTotals` the invoice's own field shape when a credit note the
 *  settlement-crossing check just sent might have settled it (see
 *  `checkAndEmitInvoiceSettledFromCreditNote` below). */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();
/** The credit note's OWN descriptor - never `INVOICE_DESCRIPTOR` above, which describes a different
 *  type's field shape. Issue #579: this descriptor never sets `stockEffect: 'decrement'`, so this is
 *  `false` - computed, not hardcoded, so it stays true to the descriptor if that ever changes. A
 *  credit note never moves stock, whatever either of its two line shapes (`lines`, `correctedLines`,
 *  credit-note.descriptor.ts) ends up carrying. */
const CREDIT_NOTE_DESCRIPTOR = buildCreditNoteDescriptor();
const CREDIT_NOTE_DECREMENTS_STOCK = decrementsStockOnIssuance(CREDIT_NOTE_DESCRIPTOR);

export interface CreditNoteActionDeps {
  queueDispatcher: DocumentActionQueueDispatcher;
  /** Issue #499 - the registry the invoice's own "send" resolves its channel from: a linked credit
   *  note travels on the channel its corrected invoice's client is reached through. */
  transportRegistry: TransportRegistry;
  /** Issue #499 - rendering the credit note's own PDF at issuance, archived whatever the channel. */
  referenceRegistry: EntityReferenceRegistry;
  /** Same optional, "no certificate is a no-op" contract as `SendDocumentEmailDeps.signingCertificates`:
   *  the archived PDF is signed exactly as the download would sign it. */
  signingCertificates?: SigningCredentialsPort;
  /** See `async-send.ts`'s own `RunAsyncSendInput.events` header. */
  events?: DocumentEventPublisher;
  /**
   * See `async-send.ts`'s own `RunAsyncSendInput.webhooks` header. Under per-type events
   * this type deliberately got NO webhook at all: the schema had no `CREDIT_NOTE_SENT` (nor any other
   * `CREDIT_NOTE_*` entry) and inventing one was deliberately avoided. The
   * generic `DOCUMENT_SENT`/`DOCUMENT_CREATED` removes the need for a per-type event entirely — this
   * type now passes the SAME `deps.webhooks` invoice/quote already do, and gets both for free.
   */
  webhooks?: DocumentWebhookEmitter;
}

/**
 * Registers the credit note type's action IMPLEMENTATIONS — "save-draft" (the exact same generic
 * mechanism the quote and the invoice already share, generic-actions.ts) and "send".
 *
 * "send" issues the credit note: numbered on entering "sending", then delivered and archived by the
 * worker like every other type's "send" (`runAsyncSendAction`, actions/async-send.ts - ONE mechanism
 * for the action id "send"). Until issue #499 its `deliver` did nothing at all: the record moved to
 * "sent", nothing was archived and nobody received anything, although a credit note is an invoice in
 * law (CGI art. 289, I, 5) that has to be kept unaltered and has to reach the client. It is now
 * delivered on the channel its corrected invoice's client is reached through and its own PDF is
 * archived at issuance - see `deliverCreditNote` below for the two shapes (linked, free) and
 * `resolveCreditNoteDelivery` for the channel.
 *
 * A credit note issued BEFORE issue #499 keeps no archive and was delivered to nobody. Nothing
 * back-dates one for it: an archive written today would claim to preserve bytes nobody issued. Its
 * download keeps rendering fresh (`documents.service.ts#renderInstancePdf` finds no archive and falls
 * back, with no status line since it is issued, issue #494), and "send" is not offered from "sent", so
 * forwarding that PDF to the client stays a manual step for those few documents.
 *
 * What also needs "sent" to exist: settlement/credits.ts only counts a credit note that is "sent": a
 * draft settles nothing.
 */
/**
 * A credit note reaching "sent" is the SECOND (and only
 * other) write path that can make an INVOICE cross into "settled" (settlement/credits.ts only counts
 * a credit note once it is "sent" — a draft settles nothing): the invoice's own "record-payment"
 * (invoice-actions.ts) covers the first. Called ONLY once `sentCreditNote.status === 'sent'` is
 * genuinely true in Postgres (see this file's own "send" registration below — never on phase 1,
 * where the record is merely "sending").
 *
 * "Before" is computed the same way invoice-actions.ts's own record-payment does — the SAME set of
 * credit notes, minus the one that JUST became "sent" (never a snapshot taken a moment earlier,
 * which would need a second query and open a race window) — `listCreditNotes` already reads the
 * CURRENT database state, where this note is already "sent", so filtering it OUT reconstructs exactly
 * what settlement looked like the instant before this write. The invoice's PAYMENTS are unaffected by
 * a credit note's own "send", so they are read once and reused on both sides of the comparison.
 *
 * Never throws — wrapped entirely in its own try/catch, the same "a third party's webhook endpoint
 * being down must never undo, or even be visible from, the write that just succeeded" discipline
 * every other `DOCUMENT_*` dispatch site holds (see async-send.ts's own `DOCUMENT_SENT` block): a
 * credit note that failed to reach the invoice it corrects (deleted invoice, a transient DB hiccup)
 * must not turn "the credit note was sent" into a 500 the user never asked for.
 */
async function checkAndEmitInvoiceSettledFromCreditNote(
  companyId: string,
  sentCreditNote: DocumentInstanceResult,
  webhooks: DocumentWebhookEmitter | undefined,
): Promise<void> {
  if (!webhooks) return; // no capability, no effect — same guard emitDocumentSettled itself holds.
  try {
    const noteData = (sentCreditNote.data ?? {}) as Record<string, unknown>;
    const invoiceId = typeof noteData.invoice === 'string' ? noteData.invoice : undefined;
    if (!invoiceId) return;

    const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
    const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, invoiceData);
    const paymentInputs = toSettlementPaymentInputs(await listPayments(companyId, invoiceId));

    const allNotes = await listCreditNotes(companyId);
    const notesBefore = allNotes.filter((note) => note.id !== sentCreditNote.id);
    const { credits: creditsBefore } = creditsForInvoiceFromNotes(
      notesBefore,
      invoiceId,
      INVOICE_DESCRIPTOR,
      invoiceData,
    );
    const { credits: creditsAfter } = creditsForInvoiceFromNotes(
      allNotes,
      invoiceId,
      INVOICE_DESCRIPTOR,
      invoiceData,
    );

    const before = computeSettlement(
      totals.grossMinor,
      paymentInputs,
      toSettlementCreditInputs(creditsBefore),
    );
    const after = computeSettlement(totals.grossMinor, paymentInputs, toSettlementCreditInputs(creditsAfter));

    if (crossedIntoSettled(before, after)) {
      await emitDocumentSettled(webhooks, companyId, 'invoice', invoice, after);
    }
  } catch (error) {
    logger.error('Failed to check/emit DOCUMENT_SETTLED after a credit note was sent', {
      category: 'documents',
      details: {
        companyId,
        creditNoteId: sentCreditNote.id,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** Whether this credit note corrects an invoice at all — the fork `credit-note.descriptor.ts`'s own
 *  "Two shapes, one type" header describes. Pulled out as its own predicate since three separate
 *  guards below all need the identical "linked or free" read of the same field. */
function hasOriginInvoice(data: Record<string, unknown>): boolean {
  return typeof data.invoice === 'string' && data.invoice.length > 0;
}

/**
 * PR #473 review point 2 (owner decision): a credit note has no legal basis AT ALL for a Polish
 * seller - LINKED or FREE, never mind which. This used to only guard the FREE shape (a "no invoice
 * to reference" gap), on the theory that a LINKED credit note was still a legitimate, if oddly named,
 * way to reduce what an invoice owes. That theory was wrong, and countries/data/pl.json (section "policy")'s own
 * `numbering` fact for this type already said so before the code caught up (`requirement:
 * 'type-not-issuable'`, citing art. 106j ust. 2 pkt 2, "numer kolejny oraz datę jej wystawienia" -
 * a faktura korygująca must carry a sequential number of its own): this document type is not, and
 * cannot become, that KOR invoice - it has no numbering series of its own for a Polish seller at all
 * (credit-note.descriptor.ts's own numbering header). The credit note is refused OUTRIGHT for a
 * Polish seller - the faktura korygująca is already implemented as a `KOR` INVOICE
 * (`correctsInvoiceId`, invoice.descriptor.ts; countries/data/pl.json (section "correctionRoutes")'s own
 * CORRECTIVE_INVOICE route, 'required'/'implemented'), numbered in the INVOICE's own series, never
 * this type's.
 *
 * Reads the CATALOG, never a second, hand-kept country list here - a future country file changing its
 * own CREDIT_NOTE status changes this decision automatically, with nothing in this action to revisit.
 * `hasOriginInvoice` only decides the wording of the refusal now (still useful context for whoever
 * reads it), never whether it fires - see this function's own name change, from
 * `assertFreeCreditNoteAllowedForCountry` to this.
 *
 * ALSO the belt-and-braces enforcement behind countries/data/pl.json (section "policy")'s own `save-draft`/`send`
 * rules (`allowed: false`, PR #473) - `documents.service.ts#runAction`'s own `evaluateCountryPolicy`
 * gate already refuses both actions with a 403 before this handler is ever reached in the ordinary
 * HTTP path, but this guard is what a scripted/internal caller that bypassed that gate would still
 * hit - the same "the screen/framework gate is never trusted alone" posture every other guard in this
 * module already holds.
 *
 * Reads the SELLER's own country the same way every other country-aware guard in this module does
 * (`resolveCompanyCountryCode`) — an UNRESOLVED country, or one with no correction-routes file at all,
 * blocks NOTHING here: this guard only ever NARROWS an already-permitted action, it never invents the
 * FIRST refusal a missing country file would already be (`country-policy.ts`'s own DECISION 1, a
 * separate gate that already ran before this one even executes).
 *
 * Existing Polish credit notes (issued before this decision took effect) are UNAFFECTED going
 * forward: this guard only runs on "save-draft"/"send" (creating or re-editing one), never on a read,
 * a PDF render, or "share-link" - see credit-note.descriptor.ts's own `countries/data/pl.json (section "policy")`
 * rule for `share-link` staying `allowed: true` for exactly that reason.
 */
async function assertCreditNoteAllowedForCountry(
  companyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const countryCode = await resolveCompanyCountryCode(companyId);
  if (!countryCode) return;

  const decision = resolveCorrectionRoutesForCountry(countryCode);
  const creditNoteRoute = decision?.routes.find((route) => route.routeId === 'CREDIT_NOTE');
  if (creditNoteRoute?.status !== 'forbidden') return;

  const shape = hasOriginInvoice(data) ? 'linked to an invoice' : 'free-standing';
  throw new BadRequestException(
    `${countryCode} has no credit note instrument at all (this one is ${shape}) - ${creditNoteRoute.label}. ` +
      'Use a corrective invoice ("faktura korygująca") instead: create an invoice with "Corrects ' +
      'invoice" set to the one you need to correct.',
  );
}

/**
 * The two ways this type carries an amount — `correctedLines` (a POINTER into the invoice's own
 * lines, meaningful only once `invoice` is set) and `lines` (a fresh table of the user's own rows,
 * meaningful only once it is not) — are mutually exclusive, never both at once on the same record.
 * Enforced here, not by the descriptor's own `required`/`requiredIfPresent`/`requiredIfAbsent` hints
 * alone: those can each say "this field must be present", but none of them can say "and that OTHER
 * one must be empty" — a scripted client posting both would otherwise leave two disagreeing sources
 * of truth for what this credit note actually credits, with `totals/compute-totals.ts` silently
 * pricing `lines` and ignoring `correctedLines` entirely (that function only ever looks for 'array'
 * fields with a money+number subfield pair — `correctedLines` is a 'rowSelection', not one, so it
 * would never even notice the disagreement).
 *
 * The "at least one row" floor for EACH shape is also decided here, deliberately NOT as a static
 * `min` on either field's own descriptor entry: neither field is unconditionally required any more
 * (both fork on the SAME sibling, `invoice`), and `validateAgainstDescriptor`
 * (descriptors/validate.ts) only ever skips a kind's own validator when the value is genuinely
 * MISSING — an empty array (`[]`, what this app's own form always submits for an untouched
 * 'array'/'rowSelection' field, see schema.ts's `defaultValuesFor`) is NOT missing, so a static
 * `min: 1` would fire on the shape that is legitimately empty just as readily as the one that is not
 * (e.g. `correctedLines: []` on a genuinely FREE note, which has every reason to be empty). Two
 * explicit checks below, one per shape, read far more plainly than trying to make one declarative
 * `min` conditional on a sibling the core field-kind vocabulary has no notion of.
 */
function assertCreditNoteAmountSourceIsUnambiguous(data: Record<string, unknown>): void {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const correctedLines = Array.isArray(data.correctedLines) ? data.correctedLines : [];

  if (hasOriginInvoice(data)) {
    if (lines.length > 0) {
      throw new BadRequestException(
        'A credit note either corrects an invoice\'s own lines ("Corrected lines") or carries its own ' +
          'free-amount lines ("Lines") — never both at once. Clear one before saving.',
      );
    }
    if (correctedLines.length === 0) {
      throw new BadRequestException(
        'A credit note that corrects an invoice needs at least one corrected line ("Corrected ' +
          'lines") — otherwise there is nothing to credit.',
      );
    }
    return;
  }

  if (lines.length === 0) {
    throw new BadRequestException(
      'A credit note with no invoice to correct needs at least one line of its own ("Lines") — ' +
        'otherwise there is nothing to credit.',
    );
  }
}

/**
 * The currency a credit note declares has no business meaning independent of
 * the invoice it corrects: a credit note carries NO conversion of its own (settlement/
 * credits.ts credits whatever it declares directly against the invoice's own, un-converted balance —
 * see that file's own header: no conversion — structurally in the invoice's own
 * currency) — so a credit note in a currency OTHER than its invoice's is not a second
 * valid business case with its own rule, it is a data-entry mistake with no sensible reading at all,
 * refused outright rather than silently miscounted forever against the wrong total.
 *
 * Once `data.invoice` IS set (a LINKED credit note, never the free shape — see this file's own
 * `hasOriginInvoice`), it is already GUARANTEED to resolve to a real, owned invoice by the time this
 * handler ever runs: `correctedLines` (credit-note.descriptor.ts, kind: 'rowSelection',
 * `requiredIfPresent: 'invoice'`) is then required, so `validateRowSelections`
 * (documents.service.ts#runAction, BEFORE any handler) has already fetched and confirmed this exact
 * invoice exists — the SECOND `findOwnedDocument` call below is a deliberate, cheap re-read (that
 * validation lives in a different module, with no shared cache), not a sign this branch is otherwise
 * unreachable.
 *
 * TWO call sites, deliberately — both write paths that can change what `data.currency` persists.
 * `registerCreditNoteSaveDraftAction` below guards "save-draft" (creation AND every later re-edit,
 * since that action ALWAYS persists whatever `data` it receives). `registerCreditNoteActions`'s own
 * "send" registration guards the SECOND, easy-to-miss path: `async-send.ts`'s phase-1 `preflight`
 * runs BEFORE its own `upsertDocument` persists the submitted `data` as "sending" — a scripted
 * client could otherwise call "send" directly (skipping "save-draft" entirely) with a mismatched
 * currency and have it persisted uncaught. Same guard, same function, never a second copy of the
 * comparison.
 *
 * Screen-side, `credit-note.descriptor.ts`'s own `currency` field declares `lockedFromReference`
 * (descriptors/types.ts) so the create/edit form never lets a user TYPE a mismatch in the first
 * place — this is the hard backstop for whatever reaches the API directly, the same "the screen is
 * never trusted alone" posture invoice-actions.ts's own buyer-country guard
 * already holds.
 */
async function assertCreditNoteCurrencyMatchesInvoice(
  companyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const invoiceId = typeof data.invoice === 'string' ? data.invoice : undefined;
  // A FREE credit note (credit-note.descriptor.ts's own "Two shapes, one type") has no `invoice` at
  // all — genuinely reachable now that the field is optional, and correctly a no-op: there is nothing
  // to compare this note's own currency against, so it stays the user's free choice (this function's
  // whole job is comparing TWO currencies, and a free note only ever has one).
  if (!invoiceId) return;

  const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
  const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
  const invoiceCurrency = invoiceData.currency;
  // The invoice itself has no currency yet (a country-less-safe DRAFT, per invoice.descriptor.ts's
  // own posture) — nothing sensible to compare against; this credit note's own currency stays the
  // user's choice, unblocked, until the invoice it corrects actually has one.
  if (typeof invoiceCurrency !== 'string') return;

  if (data.currency !== invoiceCurrency) {
    throw new BadRequestException(
      `This credit note declares "${String(data.currency)}", but the invoice it corrects ` +
        `(${invoice.displayNumber ?? invoiceId}) is in "${invoiceCurrency}" — a credit note has no ` +
        'business existing in a currency other than the invoice it corrects: the amount it credits ' +
        `is structurally denominated in that invoice's own currency, with no conversion of its own. ` +
        `Pick "${invoiceCurrency}".`,
    );
  }
}

/**
 * "save-draft" for the credit note — NOT the plain generic mechanism: wraps
 * `performSaveDraft` (generic-actions.ts) with THREE guards above (amount-source, country, currency —
 * in that order: structural shape first, then whether a free note is legal for this seller at all,
 * then the currency comparison, which only ever has something to compare once `invoice` resolves
 * anyway), the same "diverge from the shared mechanism for one documented, invoice-shaped reason"
 * precedent invoice-actions.ts's own `registerInvoiceSaveDraftAction` already set — this is
 * credit-note's analogous case, not a coincidence: both types need extra checks the generic
 * mechanism has no business knowing about, and both reuse `performSaveDraft` for the actual
 * persistence so the two never drift.
 *
 * FOURTH guard, added for issue #468: a credit note is legally an invoice (CGI art. 289, I, 5), so
 * once it has left "draft" it is issued and must never be rewritten. `credit-note.descriptor.ts`'s
 * "save-draft" now declares `lockedStatuses` for every status but "draft", so
 * `documents.service.ts#runAction` already refuses this before ANY handler runs - the check right
 * below can only ever fire for a caller that reached this handler WITHOUT going through `runAction`'s
 * gates, the same defense-in-depth discipline `invoice-actions.ts`'s own save-draft handler holds.
 */
function registerCreditNoteSaveDraftAction(
  registry: ActionRegistry,
  webhooks?: DocumentWebhookEmitter,
): void {
  registry.register('credit-note', 'save-draft', async (ctx) => {
    if (ctx.documentId && ctx.currentStatus && ctx.currentStatus !== 'draft') {
      throw new ConflictException(
        `Action "save-draft" of document type "credit-note" is refused once the document has left ` +
          `draft (status "${ctx.currentStatus}"): an issued document is never rewritten.`,
      );
    }
    assertCreditNoteAmountSourceIsUnambiguous(ctx.data);
    await assertCreditNoteAllowedForCountry(ctx.companyId, ctx.data);
    await assertCreditNoteCurrencyMatchesInvoice(ctx.companyId, ctx.data);
    return performSaveDraft(
      ctx.companyId,
      'credit-note',
      ctx.documentId,
      ctx.data,
      webhooks,
      // Same CAS fix as `invoice-actions.ts`'s own save-draft handler - see `performSaveDraft`'s own
      // header (generic-actions.ts) and `documents.service.ts#runAction`'s `allowedFromStatuses`
      // comment.
      ctx.allowedFromStatuses,
    );
  });
}

/**
 * Issue #499 - the channel a LINKED credit note is delivered through, and what it is built from.
 *
 * A credit note is an invoice in law (CGI art. 289, I, 5, already cited by `country-policy/data/
 * fr.json`'s numbering fact), so it is delivered exactly the way its corrected invoice's client is
 * reached: the SAME resolution the invoice's own "send" runs (`invoice-actions.ts#
 * resolveInvoiceTransport` - B2G routing for a government client, then the seller-country channel
 * mandate, then the company's own transport choice), asked about the corrected invoice's client and
 * evaluated against the CREDIT NOTE's own issue date: the mandate binds the document being issued,
 * and a credit note issued after France's 2026-09-01 start goes through the platform even when the
 * invoice it corrects was emailed before it.
 *
 * The buyer and every structured format come from `resolveCreditNoteDeliverySource`
 * (`formats/credit-note-source.ts`): the invoice's client, its selected lines priced with the invoice
 * descriptor, BG-3 / TD04 naming the invoice. That source also carries the refusals a linked credit
 * note has to answer before it can be issued at all, whatever the channel: the corrected invoice must
 * carry a number (a credit note must reference it "de façon spécifique et non équivoque", CGI art.
 * 289, I, 5), its corrected lines must still exist, and the tax treatment must resolve.
 */
async function resolveCreditNoteDelivery(
  transportRegistry: TransportRegistry,
  companyId: string,
  creditNote: DocumentInstanceResult,
  { runPreflight }: { runPreflight: boolean },
): Promise<{ resolved: ResolvedInvoiceTransport; formatSource: TransportFormatSource }> {
  const formatSource = await resolveCreditNoteDeliverySource(companyId, creditNote, CREDIT_NOTE_DESCRIPTOR);
  const buildData = (formatSource.document.data ?? {}) as Record<string, unknown>;
  const clientId = typeof buildData.client === 'string' ? buildData.client : undefined;
  const creditNoteData = (creditNote.data ?? {}) as Record<string, unknown>;
  const issueDate = typeof creditNoteData.issueDate === 'string' ? creditNoteData.issueDate : undefined;

  const resolved = runPreflight
    ? await runInvoiceSendPreflight(transportRegistry, companyId, issueDate, clientId, buildData)
    : await resolveInvoiceTransport(transportRegistry, companyId, issueDate, clientId, buildData);

  if (!resolved.transport.deliversCreditNotes) {
    // Named, never a silent issuance nobody receives: today "ksef" (Poland has no credit note at all,
    // `assertCreditNoteAllowedForCountry` above, and FA(3) refuses one, `fa3-provider.ts`) and
    // "invopop" (its GOBL conversion, `invopop/gobl-invoice.ts`, only ever builds an invoice).
    throw new NotImplementedException(
      `This credit note has to be delivered through "${resolved.transportId}", the channel its ` +
        "corrected invoice's client is reached through, and that channel cannot carry a credit note " +
        'yet. It was not issued: a credit note is an invoice in law and has to reach the client the ' +
        'same way.',
    );
  }
  return { resolved, formatSource };
}

/**
 * Issue #499 - the credit note's own PDF, rendered for delivery (no status line, issue #494) and
 * signed exactly as `documents.service.ts#renderInstancePdf` would sign it. Archived at issuance
 * whatever the channel, so the download serves the copy issued rather than a re-render that a later
 * branding, template or data change would silently alter (`rendering/archived-pdf-policy.ts`: "sent"
 * is issued for this type, so the archive is always served).
 */
async function renderCreditNoteDeliveryPdf(
  deps: CreditNoteActionDeps,
  companyId: string,
  creditNote: DocumentInstanceResult,
): Promise<ArchivedArtifactInput> {
  const rendered = await renderDocumentInstance(
    { referenceRegistry: deps.referenceRegistry },
    companyId,
    CREDIT_NOTE_DESCRIPTOR,
    creditNote,
    'delivery',
  );
  const pdf = await signRenderedPdfIfConfigured(
    deps.signingCertificates ?? new NullSigningCredentials(),
    companyId,
    rendered.pdf,
  );
  return { role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array(pdf) };
}

/**
 * Issue #499 - the credit note's `deliver()`: what used to be `async () => ({ message: undefined })`,
 * an issuance that archived nothing and reached nobody.
 *
 *  - LINKED: delivered on the channel resolved by `resolveCreditNoteDelivery` above, exactly as an
 *    invoice to the same client would be - by email with the PDF attached, or deposited in its
 *    credit-note form (EN 16931 type 381 + BG-3, FatturaPA TD04, issue #472) on an e-invoicing
 *    channel.
 *  - FREE (no invoice): issued and archived, delivered to nobody. This type has no client field
 *    (`credit-note.descriptor.ts`, "Two shapes, one type"); a free credit note has no recipient this
 *    product knows of, and none is invented. The result message says so, every time.
 *
 * The archive always holds the credit note's own rendered PDF (`renderCreditNoteDeliveryPdf`): for
 * email it IS the attachment the client received (`send-document-email.ts` hands those exact bytes
 * back); for a structured channel it is added next to the deposited file, because what the platform
 * received (Factur-X, FatturaPA) is not the PDF the download serves.
 */
async function deliverCreditNote(
  deps: CreditNoteActionDeps,
  companyId: string,
  creditNote: DocumentInstanceResult,
): Promise<{ message: string; reference?: string; providerId?: string; artifacts: ArchivedArtifactInput[] }> {
  const data = (creditNote.data ?? {}) as Record<string, unknown>;
  if (!hasOriginInvoice(data)) {
    return {
      message:
        'Credit note issued and archived. It was not delivered: a credit note that corrects no invoice ' +
        'names no client, so there is nobody to send it to. Download its PDF and send it yourself.',
      artifacts: [await renderCreditNoteDeliveryPdf(deps, companyId, creditNote)],
    };
  }

  const { resolved, formatSource } = await resolveCreditNoteDelivery(
    deps.transportRegistry,
    companyId,
    creditNote,
    {
      runPreflight: false,
    },
  );
  const result = await resolved.transport.send({
    companyId,
    document: creditNote,
    label: 'Credit note',
    formatOverride: resolved.formatOverride,
    formatSource,
  });
  const artifacts = [...(result.artifacts ?? [])];
  if (!artifacts.some((artifact) => artifact.role === 'pdf')) {
    artifacts.push(await renderCreditNoteDeliveryPdf(deps, companyId, creditNote));
  }
  return { ...result, artifacts };
}

export function registerCreditNoteActions(registry: ActionRegistry, deps: CreditNoteActionDeps): void {
  registerCreditNoteSaveDraftAction(registry, deps.webhooks);

  registry.register('credit-note', 'send', async ({ companyId, documentId, data, params }) => {
    const result = await runAsyncSendAction({
      companyId,
      typeId: 'credit-note',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      events: deps.events,
      // See async-send.ts's own `RunAsyncSendInput.webhooks` header.
      webhooks: deps.webhooks,
      // credit-note.descriptor.ts: numbering.onEnterStatus === 'sending' (issue #471).
      numberOnEnqueue: true,
      // credit-note.descriptor.ts: numbering.onlyFrom === ['draft'] - never renumber a legacy credit
      // note that reached "sending" from "send_failed" while still unnumbered (issued before this
      // feature existed). See that field's own header (descriptors/types.ts) for the full "why".
      numberingOnlyFrom: ['draft'],
      decrementsStock: CREDIT_NOTE_DECREMENTS_STOCK,
      // "send" (unlike every OTHER action) persists whatever `data` THIS
      // call submits as the record's new "sending" state (async-send.ts's own phase-1 `upsertDocument`
      // call, right after `preflight` runs) — a SEPARATE write path from "save-draft", which
      // `assertCreditNoteCurrencyMatchesInvoice` above already guards. Without this, a scripted
      // client could call "send" directly (skipping "save-draft" entirely) with a currency that
      // mismatches the invoice and have it persisted uncaught — the exact bypass this preflight
      // closes, no `data` replacement needed (returning `undefined` leaves `data` exactly as
      // submitted; only a MISMATCH ever throws).
      preflight: async ({ willNumber }) => {
        assertCreditNoteAmountSourceIsUnambiguous(data);
        await assertCreditNoteAllowedForCountry(companyId, data);
        await assertCreditNoteCurrencyMatchesInvoice(companyId, data);
        // Portugal's ATCUD (issue #497) - the invoice's own gate, on the credit note's own number
        // format and its own "NC" series (see atcud-issuance.ts's header for the legal basis). A no-op
        // outside Portugal. Only when this send is about to take a number: a legacy credit note
        // retried unnumbered (`numberingOnlyFrom` above) gets no number, so it can get no ATCUD, and
        // refusing it here would strand it in "send_failed" for a code it could never carry.
        if (willNumber) await runAtcudPreflight(companyId, 'credit-note');
        // Issue #499: a linked credit note that cannot be delivered (no channel, a channel that is
        // not ready or cannot carry a credit note, an unnumbered corrected invoice...) is refused
        // HERE, before it is numbered or queued - the invoice's own preflight discipline. `data` is
        // what phase 1 is about to persist, not yet a stored record, hence the stand-in instance.
        if (hasOriginInvoice(data)) {
          await resolveCreditNoteDelivery(
            deps.transportRegistry,
            companyId,
            { id: documentId ?? '', data, status: 'sending', displayNumber: null } as DocumentInstanceResult,
            { runPreflight: true },
          );
        }
        return undefined;
      },
      // Portugal's ATCUD, part two - frozen onto the credit note the moment it is numbered, exactly as
      // for the invoice. Never throws: see `attachAtcudToNumberedDocument`'s own header.
      onNumbered: async ({ companyId: c, documentId: id, numbered }) =>
        attachAtcudToNumberedDocument(c, 'credit-note', id, numbered),
      // Issue #499 - see `deliverCreditNote`'s own header.
      deliver: async ({ companyId: c, document }) => deliverCreditNote(deps, c, document),
    });

    // `result.document.status` is "sending" after phase 1 (draft/send_failed -> sending, the
    // synchronous API call) and "sent" only after phase 2 (the worker's replay, once
    // `runAsyncSendAction` has ACTUALLY persisted it — see that function's own header) — checking it
    // here, from OUTSIDE `runAsyncSendAction`, is what lets this stay entirely credit-note-specific
    // without adding a new generic hook to the shared engine every OTHER type would have to ignore.
    if (result.document?.status === 'sent') {
      await checkAndEmitInvoiceSettledFromCreditNote(companyId, result.document, deps.webhooks);
    }

    return result;
  });
}

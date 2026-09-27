import { BadRequestException, ConflictException } from '@nestjs/common';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentFieldDescriptor } from '../descriptors/types';
import { computeDocumentTotals, ComputeTotalsOptions, DocumentTotals } from '../totals/compute-totals';

/**
 * Issue #373 ("quotes with options"): a quote can carry two or more named options, each with its own
 * lines and its own total - see `descriptors/quote.descriptor.ts`'s own comment on the `option` line
 * subfield for why this is a flat tag on each line rather than a nested array-of-arrays. Everything
 * that needs to know "does this quote have options, and what are they" goes through the two pure
 * functions below, so the derivation rule lives in exactly one place - the descriptor's line SHAPE
 * (a 'text' subfield called "option") is a coincidence of the data model, never re-derived
 * differently by the PDF, the editor, the acceptance handlers, or the invoice conversion.
 */

const QUOTE_DESCRIPTOR = buildQuoteDescriptor();

/** A quote line, as stored in `data.lines` - untyped beyond "an object", like every other consumer
 *  of a document's own `data` in this module (compute-totals.ts, quote-to-invoice.ts). */
export type QuoteLine = Record<string, unknown>;

function quoteLines(data: Record<string, unknown> | null | undefined): QuoteLine[] {
  const lines = data?.lines;
  return Array.isArray(lines) ? (lines as QuoteLine[]) : [];
}

function optionOf(line: QuoteLine): string {
  const raw = line.option;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** A line whose `option` is left unset (or blank) once the quote genuinely HAS 2+ options - see this
 *  file's own header on `linesForOption`: such a line is COMMON to every option, not orphaned and not
 *  silently dropped. A quote with fewer than two options never asks this question at all (every line
 *  is simply "the" line, tagged or not). */
function isCommonLine(line: QuoteLine): boolean {
  return !optionOf(line);
}

/** Every line left untagged - the ones `isCommonLine` calls common. Exported so the PDF (and its
 *  frontend mirror) can render them as their OWN "Common to all options" group, distinct from any
 *  one option's own tagged rows - see `render-html.ts`'s own `optionGroups` header. */
export function commonLinesOf(data: Record<string, unknown> | null | undefined): QuoteLine[] {
  return quoteLines(data).filter(isCommonLine);
}

/**
 * The quote's own OPTIONS - the distinct, non-empty `option` values across its lines, in
 * FIRST-APPEARANCE order (never alphabetical, never insertion-into-a-Set order re-sorted: the order a
 * company typed them in is the order the client sees them in, on the PDF and on the signature page).
 * Zero or one distinct value means "no options" everywhere this is consulted - see this module's own
 * header - so a quote where every line leaves `option` blank, or where every line repeats the exact
 * same tag, is indistinguishable from one that never used this feature at all: today's behavior,
 * unchanged, no new required input.
 */
export function deriveQuoteOptions(data: Record<string, unknown> | null | undefined): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const line of quoteLines(data)) {
    const option = optionOf(line);
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}

/**
 * The ONE predicate every option-mode path (PDF render, email placeholder, portal, statistics,
 * approval threshold, acceptance, conversion, frontend summary/detail/list) must gate on - this
 * round's review finding: the option path used to be switched on by the presence of an `option` tag
 * on lines alone, trusting that no OTHER document type would ever carry one. That assumption held
 * only because the descriptor system happened to never declare an `option` subfield anywhere but the
 * quote, never because anything enforced it - an invoice created straight through the API, its
 * `data.lines` hand-crafted to include an `option` key, would have `deriveQuoteOptions` derive real
 * options for it too, `computeQuoteOptionTotals` build a QUOTE descriptor over INVOICE data, and every
 * caller above silently take the wrong branch. `typeId === 'quote'` is checked FIRST (a cheap string
 * compare) so `deriveQuoteOptions` - which walks every line - is never even asked to interpret a
 * document type it was never meant to.
 */
export function isQuoteWithOptions(
  typeId: string,
  data: Record<string, unknown> | null | undefined,
): boolean {
  return typeId === 'quote' && deriveQuoteOptions(data).length >= 2;
}

/**
 * Every line that counts toward THIS option - its own tagged lines PLUS every common (untagged)
 * line, in ORIGINAL relative order (a single filter pass over `quoteLines`, never two arrays
 * concatenated - concatenating tagged-then-common would silently reorder a common line typed
 * BEFORE an option's own lines to always print last). A common line ("Setup fee", say, added with no
 * `option` at all) is not orphaned: it is billed under whichever option the client picks, so every
 * option's own totals/lines/invoice must include it - see this file's own header and
 * `computeQuoteOptionTotals`'s own doc comment for where that actually matters. `option` itself is
 * assumed to be one of `deriveQuoteOptions(data)`'s own results.
 */
function linesForOption(data: Record<string, unknown>, option: string): QuoteLine[] {
  return quoteLines(data).filter((line) => optionOf(line) === option || isCommonLine(line));
}

export interface QuoteOptionTotals {
  option: string;
  lines: QuoteLine[];
  totals: DocumentTotals;
}

/**
 * Per-option totals - null for a quote with fewer than two distinct options (the caller then falls
 * back to the ordinary, single `computeDocumentTotals` over the whole `lines` array, exactly as
 * before this feature existed). For 2+ options, each entry's `lines`/`totals` are computed from that
 * option's own tagged rows PLUS every common (untagged) line (`linesForOption`'s own header) - a
 * "Setup fee" line nobody tagged is counted in EVERY option's total, never dropped from any of them.
 * The arithmetic itself still runs through the SAME `computeDocumentTotals` the generic engine
 * everywhere else uses - no separate arithmetic to keep in sync with it, no risk of this feature's
 * own totals ever disagreeing with its rounding/VAT-aggregation rules. There is deliberately no
 * GLOBAL total alongside these: summing several options together (the client will only ever pay for
 * ONE) would be exactly the meaningless number this issue exists to stop printing.
 *
 * `totalsOptions` is forwarded verbatim to every one of these `computeDocumentTotals` calls - in
 * particular `sellerExemptVat` (`ComputeTotalsOptions`'s own header): a franchise-base seller
 * (art. 293 B CGI) whose lines still carry a non-zero rate must never print "VAT 20%" under an
 * option any more than the single-total path does (`render-instance-pdf.ts`'s own call passes the
 * SAME `company.exemptVat` to both this function and its own `computeDocumentTotals` call - this
 * round's review finding: the omission here was a wrong legal mention on a sent document).
 */
export function computeQuoteOptionTotals(
  data: Record<string, unknown>,
  totalsOptions?: ComputeTotalsOptions,
): QuoteOptionTotals[] | null {
  const options = deriveQuoteOptions(data);
  if (options.length < 2) return null;
  return options.map((option) => {
    const lines = linesForOption(data, option);
    const totals = computeDocumentTotals(QUOTE_DESCRIPTOR, { ...data, lines }, totalsOptions);
    return { option, lines, totals };
  });
}

/**
 * The common (untagged) lines' OWN totals - informational only, never billed on their own (a
 * "Setup fee" is not a third thing the client can choose): this is what the PDF's/editor's own
 * "Common to all options" group shows alongside its rows, so a reader can see for themselves that
 * COMMON's own total plus an option's own visible rows add up to that option's own printed total
 * (`computeQuoteOptionTotals` already folds the common contribution into EVERY option's own totals
 * above). Null whenever `computeQuoteOptionTotals` itself would be (fewer than two options) or when
 * there are no common lines at all to show a group for. `totalsOptions` - same forwarding, same
 * reason, as `computeQuoteOptionTotals`'s own header just above.
 */
export function computeCommonLineTotals(
  data: Record<string, unknown>,
  totalsOptions?: ComputeTotalsOptions,
): { lines: QuoteLine[]; totals: DocumentTotals } | null {
  if (deriveQuoteOptions(data).length < 2) return null;
  const lines = commonLinesOf(data);
  if (lines.length === 0) return null;
  const totals = computeDocumentTotals(QUOTE_DESCRIPTOR, { ...data, lines }, totalsOptions);
  return { lines, totals };
}

/**
 * Validates a CHOSEN option against the quote's own derived options, at the moment of acceptance
 * (either the OTP e-signature or the manual acceptance) - the one gate both paths share, so neither
 * can drift from the other on what counts as a valid choice:
 *  - fewer than two options: no choice is meaningful. A `chosen` value is simply ignored (not an
 *    error) - the whole point of "a single-option or no-option quote keeps today's behaviour exactly,
 *    no new required input anywhere" is that a caller which never heard of this feature (or a client
 *    clicking through an ordinary quote's signature page) sends nothing, and nothing is asked of them.
 *  - two or more options: `chosen` is REQUIRED and must name one of them exactly (case-sensitive,
 *    exact string match against the tags a company itself typed - the same discipline
 *    `findVatRateById` holds for a catalog id, never a fuzzy match that could silently pick the wrong
 *    one).
 * Returns the normalized (trimmed) chosen option for the 2+ case, or `undefined` for the 0/1 case -
 * `undefined` is what both acceptance handlers pass straight through as "nothing to record".
 */
export function resolveChosenOption(options: string[], chosen: unknown): string | undefined {
  if (options.length < 2) return undefined;

  const trimmed = typeof chosen === 'string' ? chosen.trim() : '';
  if (!trimmed) {
    throw new BadRequestException(
      `This quote offers ${options.length} options (${options.join(', ')}) - choose one to accept it.`,
    );
  }
  if (!options.includes(trimmed)) {
    // Round 3 review, point 4 ("after a refused option, the client cannot choose again") - a public
    // signer who chose an option before requesting an OTP can have it renamed/removed by the issuer
    // (a "sent" quote stays editable) while they wait for the code, and the OTP-verify page had no way
    // to tell THIS refusal apart from a wrong code - it can only resend the same now-invalid name
    // forever. `OPTION_NO_LONGER_VALID_CODE` is a stable, machine-readable signal ADDED to this one
    // exception's body, on top of - never in place of - the message above: the status (400) and the
    // message are unchanged, so every existing caller that only reads `.message` keeps working exactly
    // as before. Same pattern `billing/seats-view.ts`'s own `SEAT_TAKEN_CODE` already uses (an exported
    // constant, hand-mirrored on the frontend - no shared package between the two projects).
    throw new BadRequestException({
      message: `"${trimmed}" is not one of this quote's options (${options.join(', ')}).`,
      code: OPTION_NO_LONGER_VALID_CODE,
    });
  }
  return trimmed;
}

/** See `resolveChosenOption`'s own comment on the branch that throws it. */
export const OPTION_NO_LONGER_VALID_CODE = 'OPTION_NO_LONGER_VALID';

/** Strips the `option` tag off every line - the invoice descriptor's own `lines` row shape has no
 *  such subfield at all, so a value copied verbatim would be silently ignored by
 *  `validateAgainstDescriptor` (which only ever checks DECLARED subfields - see that file's own
 *  header) but would still sit in the persisted `data`, an orphaned key from a document type the
 *  invoice was never meant to carry. Applied unconditionally (0/1-option quotes too): harmless when
 *  every line's own `option` was already empty, and correct either way - an invoice never has
 *  options of its own. */
export function stripOptionTag(lines: QuoteLine[]): QuoteLine[] {
  return lines.map((line) => {
    const { option: _option, ...rest } = line;
    return rest;
  });
}

/**
 * The lines a CONVERSION (convert-to-invoice, request-deposit, request-installments) is actually
 * allowed to use - the single mechanism `actions/convert-to-invoice.ts` and both request-* actions
 * all defer to, so the "which lines, and is a choice even settled yet" question is answered once:
 *  - 0/1 options: every line, `option` tag stripped - today's behavior, byte-for-byte.
 *  - 2+ options and `acceptedOption` IS set (the quote is "signed" or "accepted" - the only two
 *    statuses either acceptance path ever reaches): exactly that option's own lines PLUS every common
 *    (untagged) line, in original relative order, tag stripped - a "Setup fee" nobody tagged rides
 *    along with whichever option was actually chosen, it is never left behind.
 *  - 2+ options and `acceptedOption` is NOT set (still "draft"/"sent" - nothing has been chosen yet):
 *    refused with a clear 409. A quote offering several options has, by construction, no single
 *    "the" set of lines until the client (or the issuer, recording a manual acceptance) has actually
 *    picked one - proceeding with an arbitrary option (the first one typed, say) would silently
 *    invoice the WRONG offer, which is a worse failure mode than simply refusing and saying why.
 */
export function resolveInvoiceableLines(
  quoteData: Record<string, unknown>,
  acceptedOption: string | null | undefined,
  quoteLabel: string,
): QuoteLine[] {
  const options = deriveQuoteOptions(quoteData);
  if (options.length < 2) {
    return stripOptionTag(quoteLines(quoteData));
  }
  if (!acceptedOption) {
    throw new ConflictException(
      `Quote "${quoteLabel}" offers ${options.length} options (${options.join(', ')}) and none has ` +
        'been accepted yet - sign it or record a manual acceptance naming one option before ' +
        'converting it.',
    );
  }
  // Issue #373 follow-up: `acceptedOption` was validated against the options that existed at the
  // MOMENT of acceptance (`resolveChosenOption`, called from a read taken before the status write) -
  // a "sent" quote stays editable, so a rename/removal of that exact option between acceptance and
  // THIS conversion (or between two reads within acceptance itself - see `updateDocumentStatus`'s own
  // `knownUpdatedAt` guard for why that half is now closed too) can leave `acceptedOption` naming
  // something `deriveQuoteOptions` no longer lists. Silently falling through to `linesForOption` would
  // then return ONLY the common lines - a real invoice missing everything the client actually chose,
  // with nothing about the write ever saying so. Refused here, loudly, rather than guessed.
  if (!options.includes(acceptedOption)) {
    throw new ConflictException(
      `Quote "${quoteLabel}" was accepted for option "${acceptedOption}", which is no longer one of ` +
        `its options (${options.join(', ')}) - the quote was edited after acceptance. Fix the ` +
        'options or record a fresh acceptance before converting it.',
    );
  }
  return stripOptionTag(linesForOption(quoteData, acceptedOption));
}

/**
 * Refuses (400, naming the field) an `option` key on any row of any 'array' field whose OWN
 * subfields do not declare one - this round's review finding: the line validator
 * (`descriptors/validate.ts#validateAgainstDescriptor`) only ever checks fields the descriptor
 * DECLARES, so an invoice (or any other type) sent through the API with `lines[].option` set would
 * silently keep that key, losing its global total on the PDF and its Factur-X export, getting totals
 * computed with the quote's own rules wherever a caller forgot `typeId === 'quote'`, and sending an
 * email whose total is replaced by the options sentence - none of which is what an invoice, whose
 * line shape has no notion of "option" at all, is supposed to do.
 *
 * Descriptor-driven, never hardcoded to a `typeId` check: a field's own `fields` (its row shape)
 * already says whether `option` is a real, declared subfield (only quote.descriptor.ts's `lines` does
 * today) - so this generalizes for free to any future document type that legitimately reuses the same
 * subfield, without this function ever needing to name "quote" itself. Called from
 * `documents.service.ts#runAction` alongside `validateAgainstDescriptor`, for save-draft and send
 * alike, on the SAME `payload.data` that function already validates.
 */
export function rejectStrayOptionTag(fields: DocumentFieldDescriptor[], data: Record<string, unknown>): void {
  for (const field of fields) {
    if (field.kind !== 'array' || !field.fields?.length) continue;
    const declaresOption = field.fields.some((subField) => subField.key === 'option');
    if (declaresOption) continue;

    const rows = data[field.key];
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return;
      const raw = (row as Record<string, unknown>).option;
      if (typeof raw === 'string' && raw.trim()) {
        throw new BadRequestException(
          `"${field.key}[${index}].option" is not a field this document type declares - an option ` +
            'tag is only meaningful on a quote (issue #373).',
        );
      }
    });
  }
}

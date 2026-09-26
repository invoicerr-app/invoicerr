import { BadRequestException, ConflictException } from '@nestjs/common';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { computeDocumentTotals, DocumentTotals } from '../totals/compute-totals';

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
 */
export function computeQuoteOptionTotals(data: Record<string, unknown>): QuoteOptionTotals[] | null {
  const options = deriveQuoteOptions(data);
  if (options.length < 2) return null;
  return options.map((option) => {
    const lines = linesForOption(data, option);
    const totals = computeDocumentTotals(QUOTE_DESCRIPTOR, { ...data, lines });
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
 * there are no common lines at all to show a group for.
 */
export function computeCommonLineTotals(
  data: Record<string, unknown>,
): { lines: QuoteLine[]; totals: DocumentTotals } | null {
  if (deriveQuoteOptions(data).length < 2) return null;
  const lines = commonLinesOf(data);
  if (lines.length === 0) return null;
  const totals = computeDocumentTotals(QUOTE_DESCRIPTOR, { ...data, lines });
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
    throw new BadRequestException(`"${trimmed}" is not one of this quote's options (${options.join(', ')}).`);
  }
  return trimmed;
}

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
  return stripOptionTag(linesForOption(quoteData, acceptedOption));
}

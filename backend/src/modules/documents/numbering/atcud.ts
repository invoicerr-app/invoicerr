/**
 * Portugal's ATCUD ("Código Único de Documento") — pure computation only. No Prisma, no company
 * lookup, no country resolution: see `actions/atcud-issuance.ts` for the DB-touching orchestration
 * that calls into this file from the invoice "send" preflight and from the numbering step itself.
 *
 * ## The legal shape (Portaria n.º 195/2020) — quoted verbatim in country-policy/data/pt.json
 *
 * art. 4.º n.º 1: `ATCUD:CodigodeValidação-NumeroSequencial` — the two parts joined by exactly ONE
 * literal hyphen, no quotes. art. 3.º n.º 1: the "código de validação" (issued by the AT) is a string
 * of AT LEAST 8 characters (no maximum stated). art. 3.º n.º 3: the "número sequencial" is "a
 * sequência de caracteres numéricos [...] que se encontra imediatamente a seguir à barra (/)" — the
 * run of digit characters immediately after a "/" in the document's own number, per the SAF-T (PT)
 * data structure (Portaria n.º 321-A/2007).
 *
 * ## The design problem this file resolves: numbering here is a free-text PATTERN, not a fixed SERIES/NUMBER shape
 *
 * `numbering/format-number.ts`'s pattern vocabulary (`{year}`/`{month}`/`{day}`/`{number}`, plus
 * arbitrary literal characters a company types) has no built-in idea of "series" at all — a company
 * numbering `"INVOICE-{year}-{number:4}"` (this product's own shipped default,
 * `defaultNumberFormatFor`) never even puts a "/" in its document numbers. The law's own "número
 * sequencial" definition, above, is defined ENTIRELY in terms of "immediately after the /" — so a
 * pattern with no "/" at all, or with characters between the "/" and the number, cannot lawfully
 * produce an ATCUD: there is no non-invented way to say which digits "are" the sequential number.
 *
 * The decision made here, applied everywhere this file is used: REFUSE, loudly, rather than guess.
 * `parseAtcudPattern` accepts ONLY a pattern whose CONFIGURED trailing shape is a literal "/"
 * immediately followed by "{number}" or "{number:N}" AND NOTHING ELSE after it — e.g.
 * `"FT {year}/{number:4}"` (series "FT 2026", sequential "0001") or `"A-{year}/{number}"`, but NOT
 * `"{number:4}/{year}"` (number isn't last), `"FT/{number}-DRAFT"` (trailing literal after the number),
 * or `"FT-{year}-{number:4}"` (no "/" at all — this product's own shipped DEFAULT pattern, which is
 * therefore NOT ATCUD-compatible out of the box). A Portuguese company must configure a "/"-shaped
 * invoice number format before it can issue at all — see `actions/atcud-issuance.ts`'s own header for
 * where that refusal actually surfaces (a named, actionable 400, before any sequence number is spent).
 * This is the "require a compatible format" option the task brief poses as one of two defensible
 * choices; the other (silently inventing which digits are "the" sequential number) is not implemented
 * anywhere in this file, on purpose.
 */
import { renderDateTokens } from './format-number';

/** Portaria n.º 195/2020, art. 3.º n.º 1 — no maximum stated. */
export const ATCUD_MIN_VALIDATION_CODE_LENGTH = 8;

/** Thrown when a company's own number-format pattern for a type cannot lawfully produce an ATCUD
 *  sequential number — see this file's own header, "The design problem". Never thrown for a country
 *  other than Portugal: `actions/atcud-issuance.ts` never even calls into this file for one. */
export class AtcudFormatIncompatibleError extends Error {}

/** Thrown by `computeAtcud` for a validation code shorter than the legal minimum. */
export class InvalidAtcudValidationCodeError extends Error {}

/** Thrown by `computeAtcud` for a sequential-number value that is not a plain, non-empty digit
 *  string — see art. 3.º n.º 3's own "sequência de caracteres numéricos". */
export class InvalidAtcudSequentialNumberError extends Error {}

export interface AtcudPatternShape {
  /** Everything in the pattern BEFORE the mandatory trailing "/{number...}" — still a template (may
   *  itself contain `{year}`/`{month}`/`{day}` tokens), never a rendered string. Rendered against a
   *  real date by `renderAtcudSeriesId` below. */
  seriesTemplate: string;
}

/** Matches a pattern ending in a literal "/" immediately followed by "{number}" or "{number:N}" and
 *  NOTHING else — see this file's own header for why "immediately" and "nothing else after" are both
 *  load-bearing, not merely tidy. */
const ATCUD_TRAILING_NUMBER_TOKEN = /\/(\{number(?::\d+)?\})$/;

/** Any `{number...}` occurrence — used to refuse a SECOND one hiding in the series fragment itself
 *  (see `parseAtcudPattern`'s own header, "an ambiguous second numeric run"). Deliberately global so
 *  `.test()` can be called against a fragment with the trailing token already stripped off. */
const ATCUD_ANY_NUMBER_TOKEN = /\{number(?::\d+)?\}/;

/**
 * Parses a company's number-format PATTERN (the template string, e.g. `Company.numberFormats.invoice`
 * — never an already-rendered `displayNumber`) for ATCUD compatibility. Returns `undefined` — never
 * throws — for any pattern this file cannot guarantee a lawful `SERIES/NNNN` shape from; the caller
 * (`actions/atcud-issuance.ts`) is what turns that into `AtcudFormatIncompatibleError` with the
 * company's own pattern named in the message, so this pure function stays a plain predicate with no
 * opinion on how its "no" gets reported.
 *
 * Deliberately three simple, sequential checks rather than one dense regex — a pattern this
 * consequential (get it wrong and a whole product surface either wrongly blocks or wrongly accepts an
 * ATCUD-bearing invoice) is worth being able to read as three plain sentences:
 *  1. the pattern must end in a literal "/" immediately followed by "{number}"/"{number:N}" and
 *     nothing else (`ATCUD_TRAILING_NUMBER_TOKEN`);
 *  2. what remains after stripping that trailing "/{number...}" (the prospective series template)
 *     must be non-empty — an empty series id is not a real series identifier, the AT associates a
 *     code with a NAMED series (FAQ 4308/4312), never with "no series at all";
 *  3. that same series template must not itself contain ANOTHER `{number...}` token
 *     (`ATCUD_ANY_NUMBER_TOKEN`) — two numeric runs in one pattern would make "the" sequential number
 *     ambiguous, which this file refuses to guess through.
 */
export function parseAtcudPattern(pattern: string): AtcudPatternShape | undefined {
  const trailingMatch = ATCUD_TRAILING_NUMBER_TOKEN.exec(pattern);
  if (!trailingMatch) return undefined;

  const seriesTemplate = pattern.slice(0, trailingMatch.index);
  if (seriesTemplate.length === 0) return undefined;
  if (ATCUD_ANY_NUMBER_TOKEN.test(seriesTemplate)) return undefined;

  return { seriesTemplate };
}

/**
 * Renders the "series identifier" half of an ATCUD-compatible pattern against `date` — the SAME
 * `{year}`/`{month}`/`{day}` substitution `numbering/format-number.ts#formatDocumentNumber` applies to
 * a whole pattern, run here on only the portion before the mandatory "/". Called from
 * `actions/atcud-issuance.ts`'s PREFLIGHT check (predicting, before a real number is taken, which
 * series row to look up) — the CONFIRMED series id, once a document is actually numbered, is instead
 * read directly off the frozen `displayNumber` by `splitAtcudDisplayNumber` below, never re-rendered
 * from a pattern + date a second time (see that function's own header).
 */
export function renderAtcudSeriesId(seriesTemplate: string, date: Date): string {
  return renderDateTokens(seriesTemplate, date);
}

export interface AtcudDisplayNumberSplit {
  seriesId: string;
  sequentialNumber: string;
}

/**
 * Splits an ALREADY-RENDERED, frozen `displayNumber` (`DocumentInstance.displayNumber`) into its
 * ATCUD series id and sequential number, by re-validating `pattern` (the SAME pattern that produced
 * `displayNumber` — `numbering/take-number.ts#takeDocumentNumber` never changes pattern between
 * resolving and formatting) is still ATCUD-compatible, then taking the LAST "/" in `displayNumber` as
 * the split point. Using the real, already-frozen string here — rather than re-rendering the series
 * template against a date a second time — is deliberate: `pattern`'s own compatibility check already
 * guarantees the text after the last "/" is PURE digits (the number token can contain no "/" or other
 * literal character), so this split can never disagree with what was actually printed, even if the
 * series template itself contains a literal "/" of its own (e.g. `"PT/FT {year}/{number:4}"` — series
 * "PT/FT 2026", sequential "0001": `lastIndexOf('/')` still finds the RIGHT one).
 *
 * Throws `AtcudFormatIncompatibleError` if `pattern` is no longer ATCUD-compatible — a defensive
 * re-check (the real gate is the invoice "send" preflight, BEFORE any number is taken, see
 * `actions/atcud-issuance.ts`'s own header): the only way this fires in practice is a company editing
 * its number-format setting in the narrow gap between that preflight and this call.
 */
export function splitAtcudDisplayNumber(displayNumber: string, pattern: string): AtcudDisplayNumberSplit {
  if (!parseAtcudPattern(pattern)) {
    throw new AtcudFormatIncompatibleError(
      `Cannot split "${displayNumber}" into an ATCUD series/sequential pair — its own number format ` +
        `("${pattern}") is no longer ATCUD-compatible (a literal "/" immediately followed by ` +
        '"{number}" or "{number:N}", and nothing else after it, is required).',
    );
  }
  const slashIndex = displayNumber.lastIndexOf('/');
  return {
    seriesId: displayNumber.slice(0, slashIndex),
    sequentialNumber: displayNumber.slice(slashIndex + 1),
  };
}

/**
 * Given an AT-issued validation code and a document's own ATCUD sequential number, produces
 * `ATCUD:CodigodeValidação-NumeroSequencial` (Portaria n.º 195/2020, art. 4.º n.º 1) — or fails
 * loudly. Pure, synchronous, no I/O: every fact this needs is already an argument.
 *
 *  - `validationCode` shorter than `ATCUD_MIN_VALIDATION_CODE_LENGTH` (art. 3.º n.º 1) throws
 *    `InvalidAtcudValidationCodeError` — this is the ONE check `company/atcud-series/` re-applies at
 *    the settings screen too (so a company cannot even SAVE a too-short code), enforced again here so
 *    this function's own contract ("produce the string, or fail loudly") never depends on a caller
 *    having already validated its input.
 *  - `sequentialNumber` that is empty, or contains anything other than digits, throws
 *    `InvalidAtcudSequentialNumberError` — art. 3.º n.º 3's own "sequência de caracteres numéricos".
 *    Never trimmed or reformatted: a leading-zero-padded value (e.g. "0007") is passed through
 *    EXACTLY as printed elsewhere on the document, since the law names the digit characters actually
 *    used in the document's own number, not their integer value.
 */
export function computeAtcud(validationCode: string, sequentialNumber: string): string {
  if (validationCode.length < ATCUD_MIN_VALIDATION_CODE_LENGTH) {
    throw new InvalidAtcudValidationCodeError(
      `AT validation code "${validationCode}" is only ${validationCode.length} character(s) — Portaria ` +
        `n.º 195/2020, art. 3.º n.º 1 requires a minimum of ${ATCUD_MIN_VALIDATION_CODE_LENGTH}.`,
    );
  }
  if (!/^[0-9]+$/.test(sequentialNumber)) {
    throw new InvalidAtcudSequentialNumberError(
      `ATCUD sequential number "${sequentialNumber}" is not a non-empty digit string — Portaria n.º ` +
        '195/2020, art. 3.º n.º 3 defines it as "a sequência de caracteres numéricos" taken from the ' +
        "document's own number.",
    );
  }
  return `ATCUD:${validationCode}-${sequentialNumber}`;
}

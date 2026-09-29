/**
 * "Declare your last number issued" (issue #340, §2 of the research behind it): a company migrating
 * from a previous tool tells Invoicerr the last number that tool printed (and its date); Invoicerr
 * infers a candidate pattern, the company confirms it (or types its own), and this module decides
 * whether that pattern becomes the company's own RUNNING SERIES (the exact same mechanism issue #496
 * already built, `Company.numberFormats`/`numbering/company-number-format.ts#resolveNumberFormatFor`)
 * or whether the country's own format simply takes over. Either way the counter resumes at
 * `last + 1`, never at 1, and never re-issues a number. Usable WITHOUT ever importing a document (the
 * owner's own decision): a company that migrates its history by hand, one invoice at a time, still
 * needs its numbering to continue where the old tool left off.
 *
 * Pure, synchronous inference/parsing lives here; the actual write (seeding
 * `numbering/sequence.ts#seedSequenceStart`, and, for a pattern that satisfies the country's own
 * constraints, writing `Company.numberFormats`) lives in `company.service.ts#declareLastNumberIssued`,
 * the one caller allowed to touch either.
 */
import { renderDateTokens } from './format-number';

const TOKEN_PATTERN = /\{(\w+)(?::(\d+))?\}/g;

/**
 * Infers a CANDIDATE pattern from one example number, the way the research behind #340 describes:
 * "FA-2026-0142" gives "FA-{year}-{number:4}". Never authoritative on its own - the frontend shows
 * this as an EDITABLE suggestion, and `company.service.ts#declareLastNumberIssued` re-derives the
 * declared numeric value from whatever pattern the company actually confirms, never from this
 * function's own guess.
 *
 * Method: the RIGHTMOST run of digits is the sequence number (the near-universal convention every
 * shipped country format already follows - `INVOICE-{year}-{number:4}`, `FT A/{number}`, ...); if a
 * SEPARATE, earlier run of digits equals `referenceDate`'s own 4-digit year, it becomes `{year}`.
 * Returns `undefined` when the example has no digits at all - there is nothing to infer a `{number}`
 * token from, and `assertValidNumberPattern` would refuse the result anyway.
 */
export function inferNumberPatternFromExample(example: string, referenceDate: Date): string | undefined {
  const trimmed = example.trim();
  const digitRuns = [...trimmed.matchAll(/\d+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  if (digitRuns.length === 0) return undefined;

  const numberRun = digitRuns[digitRuns.length - 1];
  const yearString = referenceDate.getFullYear().toString();
  const yearRun = digitRuns.slice(0, -1).find((run) => trimmed.slice(run.start, run.end) === yearString);

  let pattern = '';
  let cursor = 0;
  const ranges = [yearRun, numberRun]
    .filter((r): r is { start: number; end: number } => r !== undefined)
    .sort((a, b) => a.start - b.start);
  for (const range of ranges) {
    pattern += trimmed.slice(cursor, range.start);
    if (range === yearRun) pattern += '{year}';
    else pattern += `{number:${range.end - range.start}}`;
    cursor = range.end;
  }
  pattern += trimmed.slice(cursor);
  return pattern;
}

/**
 * The inverse of `format-number.ts#formatDocumentNumber`: given a CONFIRMED pattern and the date it
 * was issued on, extracts the sequential number a `rendered` string actually carries. Returns
 * `undefined` when `rendered` does not match `pattern` AT ALL (the declared pattern does not honestly
 * reproduce the declared number - `company.service.ts#declareLastNumberIssued` refuses the
 * declaration in that case, naming both).
 *
 * Builds an exact-match regex from `pattern`: `{year}`/`{month}`/`{day}` become the LITERAL digits
 * `date` renders them as (via `renderDateTokens`, reused rather than re-implemented), `{number}`/
 * `{number:N}` becomes a capturing `(\d+)`, and every other character is escaped so it matches only
 * itself - the exact "known vocabulary, fail loudly on anything else" discipline
 * `formatDocumentNumber` itself already holds, applied in reverse.
 */
export function parseNumberFromPattern(pattern: string, date: Date, rendered: string): number | undefined {
  let regexSource = '';
  let lastIndex = 0;
  let unknownToken = false;
  for (const match of pattern.matchAll(TOKEN_PATTERN)) {
    const [fullMatch, key] = match;
    regexSource += escapeRegExp(pattern.slice(lastIndex, match.index));
    if (key === 'number') {
      regexSource += '(\\d+)';
    } else if (key === 'year' || key === 'month' || key === 'day') {
      // Delegates the exact rendered digits (with whatever padding this ONE token carries) to the
      // SAME renderer the forward direction uses - never a second, independently-drifting date
      // formatter.
      regexSource += escapeRegExp(renderDateTokens(fullMatch, date));
    } else {
      // An unknown token can never match anything real - same "fail loudly" posture
      // `formatDocumentNumber` itself holds for its own unknown-token case.
      unknownToken = true;
      break;
    }
    lastIndex = match.index + fullMatch.length;
  }
  if (unknownToken) return undefined;
  regexSource += escapeRegExp(pattern.slice(lastIndex));

  const exec = new RegExp(`^${regexSource}$`).exec(rendered.trim());
  if (!exec) return undefined;
  const digits = exec.find((group, index) => index > 0 && group !== undefined);
  if (digits === undefined) return undefined;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The RIGHTMOST run of digits in `value`, parsed as an integer - the sequential number of ANY
 *  number string, regardless of what pattern produced it (used by Portugal's own declare flow,
 *  which never tries to match `lastNumber` against a caller-chosen pattern the way every other
 *  country does - see `company.service.ts#declarePortugalNewSeries`). `undefined` when `value` has
 *  no digits at all.
 *
 *  Deliberately NOT `/(\d+)(?!.*\d)/`: that lookahead re-scans the remainder of the string for every
 *  position `\d+` could start at, which is polynomial in the length of a long digit run (CodeQL
 *  `js/polynomial-redos`, flagged against this exact line on a caller-supplied `value`). Collecting
 *  every digit run with the plain, non-backtracking `/\d+/g` and taking the last one is linear in
 *  `value`'s length and returns the identical result: the rightmost run, nothing else. */
export function extractTrailingNumber(value: string): number | undefined {
  const digitRuns = value.trim().match(/\d+/g);
  if (!digitRuns) return undefined;
  const parsed = Number.parseInt(digitRuns[digitRuns.length - 1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Portugal's own mandated number shape (AT FAQ 4310, `country-policy/data/pt.json`'s own
 * `mustMatch`): `TYPE SERIES/NUMBER` - e.g. "FT A/234" is type "FT", series "A", number "234". Reads
 * the SERIES back off one real, previously-issued number, so
 * `company.service.ts#declarePortugalNewSeries` can tell whether the previous tool already used
 * identifier "A" (Invoicerr's own default new-series identifier) - the ONE fact FAQ 4319 makes
 * matter here (a validation code already used, by ANY software, may never be reused).
 *
 * `undefined` for anything that does not cleanly split into `TYPE SERIES/NUMBER` (no space before
 * the series, no `/` at all, ...) - an unparseable previous number can say nothing about which
 * identifier was already used, so the caller falls back to Invoicerr's own plain default "A" rather
 * than guessing a collision that may not exist.
 */
export function parsePortugueseSeriesIdentifier(value: string): string | undefined {
  const trimmed = value.trim();
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex <= 0) return undefined;
  const beforeSlash = trimmed.slice(0, slashIndex);
  const spaceIndex = beforeSlash.indexOf(' ');
  if (spaceIndex <= 0 || spaceIndex === beforeSlash.length - 1) return undefined;
  const series = beforeSlash.slice(spaceIndex + 1).trim();
  return series || undefined;
}

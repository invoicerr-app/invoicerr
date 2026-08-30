/**
 * The document number FORMAT — a pure string template, and nothing else. This is the one piece of
 * the old, removed numbering engine this branch deliberately KEEPS: see
 * `avant-refonte-documents:backend/src/utils/pdf.ts`'s own `formatPattern` for the vocabulary this
 * reuses verbatim (`{year}`, `{month}`, `{day}`, `{number}`, `{number:N}` for zero-padding to N
 * digits) — the vocabulary was never the problem with that code.
 *
 * What WAS the problem, and what this file refuses to repeat: that old function computed
 * `number + startingNumber - 1` for a document whose `number` was `null` (a draft never numbered
 * yet) — `null + 1 - 1` is `0` in JavaScript, so EVERY draft rendered the exact same, entirely
 * plausible-looking `…-0000`. The fix is not a smarter formula, it is a different QUESTION: this
 * module is never even asked to format a number for an unnumbered document — `sequence.ts` only
 * calls `formatDocumentNumber` AFTER a real number has been taken, and every reader elsewhere
 * (document-list.tsx, render-html.ts) is expected to check `displayNumber` for null itself and show
 * an honest "no number yet" instead of ever calling this function with a fabricated stand-in.
 */

export interface DocumentNumberParts {
  /** The raw sequence value taken from `sequence.ts` — never null: a document with no number simply
   *  never calls this function at all (see this file's own header). */
  number: number;
  /** The date `{year}`/`{month}`/`{day}` are read from — the moment the number was taken, not
   *  "today": see `DocumentInstance.displayNumber`'s own schema comment on why the formatted string
   *  is frozen at issuance rather than recomputed from `new Date()` on every read. */
  date: Date;
}

const TOKEN_PATTERN = /\{(\w+)(?::(\d+))?\}/g;

/** Matches a pattern containing at least one `{number}` (with or without `:N` padding) token. */
const HAS_NUMBER_TOKEN = /\{number(?::\d+)?\}/;

/**
 * Refuses a pattern with no `{number}` token — the one invariant that actually matters: without it,
 * every document a company ever numbers would render the exact same display string, the same
 * plural-drafts symptom the old bug produced from a different cause. Called from BOTH
 * `formatDocumentNumber` itself (so the pure function can never silently mis-format) and
 * `resolveNumberFormat` below (so a company's misconfigured custom format is caught the moment it is
 * READ — "au chargement du format" — before a real sequence number is ever spent trying to format
 * it; see sequence.ts's own header on why a number must never be taken for a write that turns out to
 * fail).
 */
export function assertValidNumberPattern(pattern: string, context: string): void {
  if (!HAS_NUMBER_TOKEN.test(pattern)) {
    throw new Error(
      `Document number format ${context} ("${pattern}") has no "{number}" token — every document ` +
        'would display the exact same number. Add "{number}" (optionally "{number:N}" to pad to N ' +
        'digits) to the pattern.',
    );
  }
}

/**
 * Renders one already-taken number through `pattern` — pure, synchronous, no I/O. `{year}`/
 * `{month}`/`{day}` come from `parts.date`; `{number}` (or `{number:N}`) from `parts.number`, padded
 * with leading zeros to N digits (4 when `:N` is omitted, matching the old engine's own default —
 * see this file's header). Any OTHER `{token}` (a typo, or a future vocabulary word this function
 * does not know yet) is a loud error, never a silently-dropped or literally-echoed brace: the old
 * engine's own `default: return key;` branch (see the same historical `formatPattern`) quietly
 * turned an unknown `{token}` into the bare word `token` with no braces at all — a formatting bug
 * that would only ever be noticed by someone reading the output character by character. This module
 * would rather fail loudly, at the exact moment the bad pattern is used, than produce a plausible
 * wrong string — the same discipline `assertValidNumberPattern` above already holds for the missing-
 * `{number}` case.
 */
export function formatDocumentNumber(pattern: string, parts: DocumentNumberParts): string {
  assertValidNumberPattern(pattern, 'used to format a number');

  return pattern.replace(TOKEN_PATTERN, (fullMatch, key: string, padding: string | undefined) => {
    let value: number;
    switch (key) {
      case 'year':
        value = parts.date.getFullYear();
        break;
      case 'month':
        value = parts.date.getMonth() + 1;
        break;
      case 'day':
        value = parts.date.getDate();
        break;
      case 'number':
        value = parts.number;
        break;
      default:
        throw new Error(
          `Document number format uses an unknown token "${fullMatch}" — the known vocabulary is ` +
            '{year}, {month}, {day}, {number} (optionally "{number:N}" on any of them to pad to N digits).',
        );
    }

    const padLength = padding !== undefined ? Number.parseInt(padding, 10) : key === 'number' ? 4 : 0;
    return value.toString().padStart(padLength, '0');
  });
}

/**
 * The shipped default pattern for a type with no company-chosen format — `"{type}-{year}-{number:4}"`
 * with `{type}` substituted ONCE, here, by the type's own uppercased id (e.g. "invoice" ->
 * "INVOICE-"). `{type}` is deliberately NOT part of `formatDocumentNumber`'s own token vocabulary
 * (year/month/day/number only, per this module's header) — it is resolved before the pattern ever
 * reaches that function, exactly like a company's custom pattern would already be a plain string by
 * the time it gets there.
 */
export function defaultNumberFormatFor(typeId: string): string {
  return `${typeId.toUpperCase()}-{year}-{number:4}`;
}

/**
 * The pattern to actually use for `typeId`, given a company's own `Company.numberFormats` column
 * (`{ [typeId]: pattern }`, or null/absent for a company that never set one) — falls back to
 * `defaultNumberFormatFor` when this type has no entry. Validated HERE, eagerly, before the caller
 * (`sequence.ts`'s orchestration in `take-number.ts`) ever takes a real number from the sequence —
 * see `assertValidNumberPattern`'s own comment for why that ordering is the point.
 */
export function resolveNumberFormat(
  numberFormats: Record<string, unknown> | null | undefined,
  typeId: string,
): string {
  const configured = numberFormats?.[typeId];
  const pattern = typeof configured === 'string' && configured.length > 0 ? configured : undefined;
  const resolved = pattern ?? defaultNumberFormatFor(typeId);
  assertValidNumberPattern(resolved, `for document type "${typeId}"`);
  return resolved;
}

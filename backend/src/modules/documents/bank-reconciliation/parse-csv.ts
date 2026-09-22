import { toMinor } from '@/utils/financial';

import { CsvColumnMapping, CsvDateFormat } from './csv-mapping';

/**
 * Reads a CSV bank statement into plain, normalized lines — the READ-side counterpart to
 * `accounting-export/build-accounting-csv.ts`'s own WRITE-side RFC 4180 handling, and just as pure
 * (no I/O, no Prisma): a `text` string in, a `CsvParseResult` out, directly testable with plain
 * fixtures.
 *
 * ## The design decision: a per-import COLUMN MAPPING, not a fixed schema and not sniffing
 * "A French bank's CSV, a German one's, and an OFX file share nothing" (this feature's own brief).
 * Three answers were on the table:
 *  - a FIXED column mapping (assume one bank's own column order/format) — cheapest to write, but this
 *    product serves five countries whose banks disagree on delimiter (`,` vs `;`), decimal mark (`.`
 *    vs `,`) and date order (DD/MM vs MM/DD): a fixed mapping works for exactly one bank and refuses
 *    everyone else, which is not a real answer for a multi-country product;
 *  - SNIFFING the shape (guess the columns/date format/decimal mark from the data itself) — the most
 *    "magic", and exactly the kind of silent guess this codebase refuses everywhere else (CurrencyRate
 *    never invents a rate — settlement/convert-payment.ts; cancel-policy never invents a correction
 *    route): "01/02/2026" is a genuinely ambiguous date, and a wrong sniffed guess would corrupt every
 *    date-window match this module makes (matching.ts) without ever surfacing an error;
 *  - a per-import MAPPING the human states once (this file's choice) — no guess at all: the human
 *    names which column is which and how its numbers/dates are written, and this function only ever
 *    parses exactly what it was told. A further option, saving that mapping as a reusable named "bank
 *    profile", would remove the one repeated click on a SECOND import of the same bank — a real
 *    convenience, deliberately left out of this feature (a `BankMappingProfile` model, plus a settings
 *    screen to manage one, for a benefit that only ever saves clicks and never changes whether an
 *    import actually works) rather than built speculatively on a guess about which banks a given
 *    company will keep re-importing.
 *
 * OFX needs none of this — see `parse-ofx.ts`'s own header for why a self-describing, tagged format
 * never has to ask the human anything.
 */

export interface ParsedStatementLine {
  /** UTC midnight — see `BankStatementLine.date`'s own schema.prisma comment. */
  date: Date;
  /** Signed, in the statement's own currency's minor units — a debit line (money OUT) is parsed and
   *  kept too, never silently dropped: see this module's own schema.prisma header, "the normal case,
   *  not an error". Only a POSITIVE line is ever a reconciliation candidate (matching.ts/reconcile.ts). */
  amountMinor: number;
  label: string;
  reference: string | null;
  /** The full original row, header-keyed — kept verbatim on the persisted line for support/debugging
   *  without re-parsing the source file. */
  raw: Record<string, string>;
}

export interface CsvParseResult {
  lines: ParsedStatementLine[];
  /** One entry per SKIPPED row (a blank cell, an unparseable date/amount) — human-readable, naming
   *  the 1-based file row number. Never a silent drop: an import that skips 3 of 40 rows must SAY so,
   *  the same "honest partial degrade, never blocking" posture
   *  `received-invoices/line-totals-check.ts` already holds for its own mismatch warnings. */
  errors: string[];
}

/** Which delimiter this file actually uses — comma or semicolon, whichever the HEADER row itself uses
 *  more often. A mechanical, objective count, never a semantic guess about the DATA: unlike a date
 *  format or a decimal mark, a delimiter is either present or not, so detecting it carries none of the
 *  ambiguity this file's own header refuses to guess through elsewhere. */
export function detectCsvDelimiter(headerLine: string): ',' | ';' {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/** RFC 4180 field splitting for ONE line — the read-side mirror of `build-accounting-csv.ts`'s own
 *  `escapeField`: a quoted field may embed the delimiter or a doubled quote, an unquoted one may not.
 *  Deliberately line-based, like that file's own `toLine` — a bank export's own label never embeds a
 *  real line break in practice, so a field is never expected to span more than one physical line. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** A signed decimal amount, in MAJOR units — `decimalSeparator` names which mark is the DECIMAL one;
 *  the other of `.`/`,`, when present, is treated as a thousands-grouping mark and stripped, along
 *  with whitespace/currency symbols a bank export sometimes appends (`"1 234,56 €"`). Throws (never
 *  guesses) on anything that still isn't a finite number once cleaned — the caller turns that into a
 *  named, row-numbered entry in `CsvParseResult.errors`. */
/** `BankStatementLine.amountMinor` is a Postgres `Int`, so a value past 2^31-1 minor units cannot be
 *  stored -- about 21.4 million in a two-decimal currency. Without this bound a single oversized cell
 *  (a stray extra digit, a currency-unit mixup) parses to a perfectly finite number, passes every
 *  check here, and only fails at the INSERT -- outside the per-row try/catch, so it takes the whole
 *  import down instead of landing in `errors[]` like every other malformed row. That contradicts this
 *  module's own promise that a bad row never stops the rest of the file. The bound belongs where the
 *  row is still recoverable. */
export const MAX_STATEMENT_AMOUNT_MINOR = 2_147_483_647;

/**
 * Hard ceilings on a CSV import's SHAPE, checked before `parseBankStatementCsv` does any per-row work
 * — a WHOLE-FILE guard, distinct from the per-row `errors[]` below: a malformed row is a fact about
 * ONE row (skipped, the rest still imports — this module's own header); a file with more rows, or a
 * line with more characters, than either of these lets through is a fact about the FILE itself, the
 * same category that header's own "malformed MAPPING" already throws for.
 *
 * `rawLines.length` and each line's own `.length` are both LOOP BOUNDS this module takes directly
 * from the uploaded file, with nothing capping either otherwise: the body-parser's own JSON size
 * limit (`main.ts`, `1mb`) happens to bound the total bytes today, but this module has no business
 * depending on a ceiling declared in an unrelated file for its own safety — and raising that limit
 * tomorrow must not silently raise this one too. Both numbers are generous for a real bank export
 * (a multi-year statement is a few thousand rows; no real column header runs anywhere near 20k
 * characters) and exist only to put a floor under a pathological one.
 */
export const MAX_STATEMENT_ROWS = 50_000;
export const MAX_STATEMENT_LINE_LENGTH = 20_000;

function parseCsvAmount(raw: string, decimalSeparator: '.' | ','): number {
  const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
  const stripped = raw
    .trim()
    .replace(/[^\d,.\-+]/g, '')
    .split(thousandsSeparator)
    .join('');
  const normalized = decimalSeparator === ',' ? stripped.replace(',', '.') : stripped;
  const value = Number(normalized);
  if (normalized === '' || !Number.isFinite(value)) {
    throw new Error(`"${raw}" is not a valid amount`);
  }
  return value;
}

/** A calendar date, read per `format` — resolved to UTC MIDNIGHT (this module's own
 *  `BankStatementLine.date` schema comment: the identical "a date-only fact is a UTC-midnight Date,
 *  never a local-timezone one" discipline `settlement/convert-payment.ts` documents at length for the
 *  same trap). Throws on anything that doesn't match `format` exactly, or that isn't a real calendar
 *  day (Feb 30) — never a loose fallback that would silently accept a differently-shaped date. */
function parseCsvDate(raw: string, format: CsvDateFormat): Date {
  const trimmed = raw.trim();
  let year: number;
  let month: number;
  let day: number;

  if (format === 'YYYY-MM-DD') {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
    if (!match) throw new Error(`"${raw}" does not match YYYY-MM-DD`);
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(trimmed);
    if (!match) throw new Error(`"${raw}" does not match ${format}`);
    const first = Number(match[1]);
    const second = Number(match[2]);
    year = Number(match[3]);
    if (format === 'DD/MM/YYYY') {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1) {
    throw new Error(`"${raw}" is not a valid calendar date`);
  }
  return date;
}

/**
 * Parses a full CSV bank statement per `mapping`. `currency` is the statement's own single declared
 * currency (see `BankStatement.currency`'s own schema comment) — amounts are converted to that
 * currency's own minor units here, the one point this module touches `@/utils/financial`.
 *
 * Never throws for a bad ROW — a malformed date/amount lands in `errors` and the row is skipped, the
 * rest of the file still imports. DOES throw for a malformed MAPPING itself (a named column absent
 * from the file's own header row): that is a mistake in what the human told this function, not a fact
 * about one row, and the caller (`bank-reconciliation.service.ts`) turns it into a 400 naming exactly
 * which column could not be found.
 */
export function parseBankStatementCsv(
  text: string,
  mapping: CsvColumnMapping,
  currency: string,
): CsvParseResult {
  const rawLines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (rawLines.length === 0) {
    return { lines: [], errors: [] };
  }
  // Whole-file facts, checked BEFORE either loop below ever runs — see MAX_STATEMENT_ROWS/
  // MAX_STATEMENT_LINE_LENGTH's own header for why these live here rather than relying on a size
  // limit declared somewhere else entirely.
  if (rawLines.length - 1 > MAX_STATEMENT_ROWS) {
    throw new Error(
      `This file has ${rawLines.length - 1} data rows, over the ${MAX_STATEMENT_ROWS}-row limit a ` +
        'single import can process.',
    );
  }
  if (rawLines[0].length > MAX_STATEMENT_LINE_LENGTH) {
    throw new Error(
      `The header row is ${rawLines[0].length} characters long, over the ${MAX_STATEMENT_LINE_LENGTH}-` +
        'character limit a single line can carry.',
    );
  }

  const delimiter = detectCsvDelimiter(rawLines[0]);
  const headers = splitCsvLine(rawLines[0], delimiter);

  for (const column of [mapping.dateColumn, mapping.amountColumn, mapping.labelColumn]) {
    if (!headers.includes(column)) {
      throw new Error(`Column "${column}" was not found in the file's own header row.`);
    }
  }
  if (mapping.referenceColumn && !headers.includes(mapping.referenceColumn)) {
    throw new Error(`Column "${mapping.referenceColumn}" was not found in the file's own header row.`);
  }

  const lines: ParsedStatementLine[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const fileRow = i + 1; // 1-based, header included — what a human counts opening the file.
    // A per-ROW fact, unlike the two whole-file checks above: one absurd line does not have to take
    // the rest of the file down with it, so this degrades exactly like a bad date/amount below —
    // named in `errors`, this row skipped — rather than throwing. `splitCsvLine`'s own loop never
    // runs on more characters than this, whatever the file actually contains.
    if (rawLines[i].length > MAX_STATEMENT_LINE_LENGTH) {
      errors.push(
        `Row ${fileRow}: line is ${rawLines[i].length} characters long, over the ` +
          `${MAX_STATEMENT_LINE_LENGTH}-character limit a single line can carry.`,
      );
      continue;
    }
    const fields = splitCsvLine(rawLines[i], delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? '';
    });

    try {
      const date = parseCsvDate(row[mapping.dateColumn], mapping.dateFormat);
      const amountMajor = parseCsvAmount(row[mapping.amountColumn], mapping.decimalSeparator);
      const label = row[mapping.labelColumn] ?? '';
      const reference = mapping.referenceColumn ? row[mapping.referenceColumn] || null : null;
      const amountMinor = toMinor(amountMajor, currency);
      if (Math.abs(amountMinor) > MAX_STATEMENT_AMOUNT_MINOR) {
        throw new Error(`"${row[mapping.amountColumn]}" is out of the range a statement line can hold`);
      }
      lines.push({ date, amountMinor, label, reference, raw: row });
    } catch (error) {
      errors.push(`Row ${fileRow}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { lines, errors };
}

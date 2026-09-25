/**
 * Generic CSV decoding/parsing for the client import - separate from
 * `backend/src/modules/documents/bank-reconciliation/parse-csv.ts`'s own `detectCsvDelimiter`/
 * `splitCsvLine` (that pair is LINE-based, which is fine for a bank export where no cell legitimately
 * embeds a newline, but a client's own address or description column plausibly does) and separate
 * from `backend/src/utils/csv.ts` (a WRITE-side escaper, nothing to reuse for reading). This is a
 * full RFC 4180 parser operating over the WHOLE decoded text rather than one line at a time, so a
 * quoted field may embed a real line break.
 *
 * Runs in the BROWSER (see `client-import.service.ts`'s own header for why parsing lives here): the
 * import dialog reads the file as an `ArrayBuffer` and hands it to `decodeCsvBytes` before ever
 * touching the network, so a bad encoding or a malformed row is caught before the server sees
 * anything.
 */

/** Strips a leading UTF-8 BOM (`﻿`) from already-decoded text - `TextDecoder` does NOT do this
 *  itself (its `ignoreBOM` option, left at its default `false`, only means "do not throw on one", not
 *  "remove it" - the codepoint survives into the decoded string). Left in place, it would land inside
 *  the FIRST header cell (`'﻿type'` instead of `'type'`), silently breaking every header-name
 *  lookup against it. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Decodes raw file bytes as UTF-8 first, falling back to Windows-1252 only if the bytes are not
 * valid UTF-8 - never the other way around, and never a silent "replace invalid bytes" decode: a
 * `TextDecoder('utf-8', { fatal: true })` THROWS on an invalid byte sequence rather than substituting
 * U+FFFD, which is exactly what makes "is this actually UTF-8" a real, unambiguous question here
 * instead of a guess. Any valid UTF-8 file, accented characters included, decodes as UTF-8; only a
 * file whose bytes are NOT valid UTF-8 (the classic case: a spreadsheet exported "for Windows",
 * Windows-1252) falls through to the second decoder - which, importantly, never fails: every byte
 * value 0x00-0xFF maps to SOME character in Windows-1252, so this function always returns a string,
 * never throws.
 */
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    return stripBom(utf8)
  } catch {
    return stripBom(new TextDecoder("windows-1252").decode(buffer))
  }
}

/** Whichever of `,`/`;` appears more often in the header line - the same mechanical, non-guessing
 *  rule `bank-reconciliation/parse-csv.ts#detectCsvDelimiter` already uses for the identical
 *  question, kept independent rather than imported since that function is line-based and this
 *  module's own `parseCsv` below needs the delimiter before it has split anything into lines at
 *  all (a quoted multi-line field means "the header line" is not simply `text.split("\n")[0]`,
 *  it is everything up to the first UNQUOTED newline). */
export function detectDelimiter(headerLine: string): "," | ";" {
  const commas = (headerLine.match(/,/g) ?? []).length
  const semicolons = (headerLine.match(/;/g) ?? []).length
  return semicolons > commas ? ";" : ","
}

export interface ParsedCsv {
  headers: string[]
  /** One entry per data row (header excluded), each itself header-length-aligned with `headers`
   *  (a short row is padded with `""`, a long one's extra cells are dropped - same "never throw on a
   *  ragged row" posture the rest of this codebase's CSV readers hold). */
  rows: string[][]
}

/** The four characters `backend/src/utils/csv.ts#isSpreadsheetFormula` treats as "this cell is a
 *  formula" (plus the two whitespace characters that reach a spreadsheet's own formula parser the
 *  same way once a leading run of them is skipped - see that file's own header) - kept in sync BY
 *  HAND with that constant rather than imported, since the backend and this parser are two
 *  independent npm projects (the same convention `ClientImportRow` already holds against
 *  `client-import.types.ts`). Read-side mirror of the WRITE-side guard: `toCsvLine` prefixes a `'`
 *  to any cell starting with one of these (so a spreadsheet reads `=SUM(...)`/`+33...` as literal
 *  text, never evaluates it as a formula) - the downloadable template's own phone example,
 *  `+33 1 23 45 67 89`, is written as `'+33 1 23 45 67 89` for exactly this reason. Uploading that
 *  SAME file back must reproduce the original value, so this parser undoes precisely that one
 *  prefix and nothing else. */
const FORMULA_GUARD_LEAD = /^[=+\-@\t\r]/

/**
 * Undoes `toCsvLine`'s own formula guard on ONE already-parsed cell: a leading `'` immediately
 * followed by one of the characters that guard targets is removed; anything else (no leading `'`,
 * or a leading `'` followed by something the guard would never have prefixed, e.g. `'Twas a client`)
 * is returned UNCHANGED. This also covers the OTHER real-world path to the same bytes: opening the
 * downloaded template in Excel/LibreOffice and re-saving it typically drops that leading apostrophe
 * itself (the spreadsheet reads it as ITS OWN "treat this as text" hint, not literal content) and
 * writes the guarded value back out bare (`+33 1 23 45 67 89`, no apostrophe) - a value already
 * shaped like that never matches this function's own leading-apostrophe check, so it passes through
 * unchanged too, and both round-trip shapes end up at the identical, original value.
 */
export function stripFormulaGuard(value: string): string {
  if (value.length < 2 || value[0] !== "'") return value
  const rest = value.slice(1)
  return FORMULA_GUARD_LEAD.test(rest) ? rest : value
}

/**
 * Full RFC 4180 parse of `text` (already decoded - see `decodeCsvBytes`) into a header row and data
 * rows. Handles a quoted field embedding the delimiter, a literal double quote (`""`), and a real
 * line break - the three cases a naive `text.split("\n").map(l => l.split(","))` gets wrong, and
 * exactly the cases the issue calls out by name. Every cell (header and data alike) also goes
 * through `stripFormulaGuard` here, once, at the one place every cell is finalized - never
 * per-column in a caller, which would have to remember to apply it to every NEW column this import
 * ever grows.
 */
export function parseCsv(
  text: string,
  delimiter: "," | ";" = detectDelimiter(text.split(/\r\n|\r|\n/)[0] ?? ""),
): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0
  const n = text.length

  function endField() {
    row.push(stripFormulaGuard(field))
    field = ""
  }
  function endRow() {
    endField()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += char
      i++
      continue
    }
    if (char === '"') {
      inQuotes = true
      i++
      continue
    }
    if (char === delimiter) {
      endField()
      i++
      continue
    }
    if (char === "\r") {
      // \r\n or a lone \r - either way this row is done; a following \n is swallowed as part of the
      // same line break rather than starting an empty extra row.
      if (text[i + 1] === "\n") i++
      endRow()
      i++
      continue
    }
    if (char === "\n") {
      endRow()
      i++
      continue
    }
    field += char
    i++
  }
  // A trailing field/row with no final line break - the common case for a file with no trailing
  // newline at all.
  if (field.length > 0 || row.length > 0) {
    endRow()
  }

  // A wholly blank trailing line (a file ending in a real newline) parses to one empty-string field -
  // dropped here rather than surfacing as a spurious empty data row.
  const nonBlank = rows.filter((r) => !(r.length === 1 && r[0] === ""))

  const [headerRow, ...dataRows] = nonBlank
  const headers = (headerRow ?? []).map((h) => h.trim())
  const alignedRows = dataRows.map((r) => headers.map((_, idx) => r[idx] ?? ""))

  return { headers, rows: alignedRows }
}

/**
 * Local, 100% offline OCR engine client — MANDANT DECISION (verbatim, mid-task): "J'ai pas de clé
 * Mistral, pour moi en local faut lancer un service Docker qui fait ça" — the honest, no-cloud-key
 * counterpart to `mistral-client.ts`. Same caller (`ocr-server.ts`, `ROLE=ocr`), same output shape
 * (`ExtractedInvoiceProposal`), same "never invent a field" discipline — but the underlying engine
 * is a plain HTTP call to a SEPARATE, self-hosted Docker container (never a cloud API, never an
 * API key), and the extraction is a HEURISTIC text scrape rather than Mistral's own structured
 * `document_annotation` — see this file's own header below for exactly what that costs.
 *
 * ## Which local engine, and why — the three candidates this task actually evaluated (all facts
 * below verified LIVE in this task's own sandbox, `docker pull` + real `curl` round-trips against
 * real containers, 2026-09-05 — never taken from documentation alone)
 *
 *  1. `hertzg/tesseract-server` (MIT, actively maintained: 294 commits, image rebuilt within the
 *     last month) — a thin HTTP wrapper around the `tesseract` CLI. VERIFIED: `POST /tesseract`
 *     (multipart `options` JSON + `file`) returns `{"data":{"exit":{...},"stdout":"...",
 *     "stderr":"..."}}` (NOT the flat `{exit,stdout,stderr}` its own README shows — the real
 *     response nests under a `data` key, confirmed by an actual round-trip). Ships `eng`/`deu`/
 *     `fra`/`pol`/`rus`/`spa`/`kat` out of the box; `ita`/`nld` are addable at container start via
 *     `TESSERACT_SERVER_INSTALL_LANGUAGES=ita,nld` — so all SIX languages this task asked about
 *     (fra/nld/deu/ita/pol/eng) are reachable with one env var. On a real rasterized (image-only,
 *     no text layer) invoice PNG it OCR'd cleanly.
 *     DISQUALIFYING FINDING: it does NOT read PDF. A real round-trip against a genuine image-only
 *     PDF (built by rasterizing that same PNG, exactly the shape `apply-ocr-fallback.ts` hands this
 *     client — see that file's own header, OCR is only ever tried on a PDF) answered
 *     `"stderr":"Error in pixReadMem: Pdf reading is not supported\n"`. Tesseract/Leptonica in this
 *     image were built without PDF support. Converting a PDF to an image first, ourselves, would
 *     need EITHER a new npm dependency (ruled out — this task's own root instruction) OR a system
 *     binary (`pdftoppm`/poppler) whose presence in this backend's OWN base image
 *     (`ghcr.io/invoicerr-app/server-image:latest`, built in a DIFFERENT repo this task cannot
 *     touch) is not something this task can verify or guarantee. Ruled out on this basis alone.
 *  2. PaddleOCR — no official, maintained, single-`docker run` HTTP-serving image was found with the
 *     same directness as the two candidates above (PaddleOCR's own serving story is a Python
 *     package/`hub serving` step layered on `paddlepaddle` base images, not a turnkey "one image,
 *     one HTTP endpoint" the way both other candidates already are). Ruled out for NOT meeting the
 *     "image publique maintenue, API HTTP simple" bar as cleanly as Tika did — not because it is
 *     unmaintained, but because this task found no equally simple, citable, single-image HTTP
 *     contract to depend on with the same confidence.
 *  3. `apache/tika:latest-full` (Apache Software Foundation, Apache-2.0, official ASF release,
 *     image rebuilt within days of this task — the most actively maintained of the three by a wide
 *     margin) — CHOSEN. VERIFIED: `PUT /tika` with the raw file bytes and `Accept: text/plain`
 *     returns PLAIN TEXT directly (no JSON envelope at all) — the simplest of the three APIs. Most
 *     importantly: **it reads the PDF itself** — PDFBox rasterizes each page and hands it to its
 *     own bundled Tesseract when a page carries no text layer, with ZERO extra code, no new
 *     dependency, no separate conversion step, on either side of this HTTP call. A real round-trip
 *     against a genuine image-only invoice PDF (same one candidate 1 above failed on) came back
 *     with the full invoice text, correctly recognized, no special headers required (an OCR
 *     strategy header exists, `X-Tika-PDFOcrStrategy`, but the default already triggers OCR for a
 *     page with no extractable text). This is the decisive, load-bearing fact: choosing Tika means
 *     this client stays a bare `fetch`, no PDF-to-image step anywhere in this codebase.
 *
 * ## THE HONEST LIMIT — stated up front, never hidden (mandant's own words: "NE CACHE PAS la
 * limite")
 *
 *  - **Language coverage**: `apache/tika:latest-full`'s own Dockerfile bakes in a FIXED language
 *    set at build time (`ARG LANGUAGES='eng ita fra spa deu jpn'`, confirmed by reading that
 *    Dockerfile directly, and by `tesseract --list-langs` inside a running container: `deu eng fra
 *    ita jpn spa`) — unlike `tesseract-server`'s runtime env var, Tika's language set is NOT
 *    operator-configurable without building a custom image (`FROM apache/tika:latest-full` +
 *    `apt-get install tesseract-ocr-pol tesseract-ocr-nld`, one extra `RUN` line — left as an
 *    operator option, documented in `docker-compose.yml`'s own comment, not automated here).
 *    CONCRETELY: **Polish and Dutch invoices get OCR'd with the WRONG language model** on the stock
 *    image (verified live: requesting `X-Tika-OCRLanguage: pol` against a container with no Polish
 *    pack installed does not error — it silently falls back to Tika's default language guess). This
 *    is a real, known gap for exactly the languages this task was asked to cover.
 *  - **Structured extraction vs. plain text**: Mistral's `document_annotation` is the MODEL reading
 *    the invoice and answering a JSON SCHEMA directly. This client gets back UNSTRUCTURED TEXT and
 *    then runs the SAME KIND OF REGEXES a human skimming the page would use — proximity of a
 *    multilingual keyword to a number-shaped token, nothing more. It has no understanding of layout,
 *    tables, or which number is really "the" total when several candidates exist. It is
 *    meaningfully weaker than the cloud path, by design, in exchange for costing nothing and
 *    sending nothing offsite. Every field below is either found or OMITTED — never guessed — the
 *    same "an editable proposal is the safety net" contract Mistral's own path holds (`extractor.
 *    ts`'s own header: OCR is always a PROPOSAL, the upload screen never auto-commits it). NOTE:
 *    the main backend's own plugin (`plugins/ocr/providers/mistral/mistral.ts`,
 *    `MistralOcrProvider.id = 'mistral-ocr'`) is a thin HTTP client of `OCR_SERVICE_URL` ALONE —
 *    it has no notion of `OCR_ENGINE` and never did (that switch lives entirely inside THIS
 *    service, see `ocr-server.ts`'s own header) — so `OcrOutcome.extractorId` on the upload screen
 *    still reads `'mistral-ocr'` even when the instance behind it is running `OCR_ENGINE=local`. A
 *    pre-existing naming quirk, out of this task's own scope to rename (the id is surfaced in one
 *    test literal only, `extractor.spec.ts`, never asserted against by anything user-facing), left
 *    here documented rather than silently inherited.
 *  - **VAT id detection**: a GENERIC EU-shaped regex (`[A-Z]{2}` + 6-12 alphanumerics), filtered by
 *    a short, HARD-CODED allow-list of country prefixes kept in THIS file — deliberately NOT
 *    imported from `country-identifiers/data/*.json` (that data is this app's own authoritative,
 *    per-country identifier registry; wiring the OCR container's throwaway text-scrape to it would
 *    be a real coupling for a heuristic that is explicitly allowed to be wrong). An IBAN shares the
 *    same "two letters then digits" shape as a VAT id — lines containing "IBAN" are excluded, and a
 *    line naming a VAT-ish keyword (TVA/VAT/IVA/USt/MwSt/NIP/BTW) is preferred over a bare
 *    pattern match anywhere in the text, but a document with no such keyword at all can still
 *    misfire on any other two-letters-then-digits token it contains.
 *  - **Supplier name**: "the first non-blank line that isn't a generic invoice-title word" — no
 *    layout awareness at all (Tika's plain-text output loses position/font-size entirely). A
 *    letterhead with a logo-only top line, no printed company name as the very first line, defeats
 *    this outright — it will pick whatever text line happens to come first.
 */
import { ExtractedInvoiceProposal } from '@/modules/documents/received-invoices/ocr/extractor';

const DEFAULT_TIMEOUT_MS = 60_000;

/** Named per this file's own "never a bare Error" discipline — the same shape `MistralOcrError`/
 *  `MistralOcrTimeoutError` already establish one file up, reused here for the identical reason:
 *  `ocr-server.ts`'s `statusForError` needs to tell a timeout (504) apart from an upstream HTTP
 *  status (passed through) apart from a network-level failure (502), for EITHER engine. */
export class LocalOcrError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LocalOcrError';
  }
}

export class LocalOcrTimeoutError extends LocalOcrError {
  constructor(timeoutMs: number) {
    super(`Local OCR engine request timed out after ${timeoutMs}ms.`);
    this.name = 'LocalOcrTimeoutError';
  }
}

// ---------------------------------------------------------------------------------------------
// Heuristic text -> ExtractedInvoiceProposal mapping — see this file's own header for the honest
// limits. Every regex below was validated against a REAL OCR transcript (this task's own
// `apache/tika:latest-full` round-trip on a genuine rasterized invoice) before being written here,
// not invented blind — kept intentionally simple, and each one documented with what it does and
// does NOT handle.
// ---------------------------------------------------------------------------------------------

/** A short, HARD-CODED allow-list of two-letter prefixes real European VAT ids use — see this
 *  file's own header on why this is deliberately NOT sourced from `country-identifiers/`. Covers
 *  every EU member (+ `EL` — Greece's own VAT prefix, distinct from its ISO code `GR`, + `XI` —
 *  Northern Ireland's post-Brexit prefix) plus three close non-EU neighbours (`CH`, `NO`, `GB`)
 *  whose invoices are common enough in this app's own European-first user base to be worth the
 *  extra three entries. */
const EU_VAT_PREFIXES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'GR',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'XI',
  'CH',
  'NO',
  'GB',
]);

/** Two letters + 6 to 12 alphanumerics — the shape essentially every European VAT id shares (e.g.
 *  `FR12345678901`, `DE123456789`, `BE0999999999`). Loose on purpose: this only decides WHERE a
 *  candidate might be, `EU_VAT_PREFIXES` above and the keyword-context preference in
 *  `findVatId` below do the actual filtering. */
const VAT_ID_SHAPE_RE = /\b([A-Z]{2})[ -]?([0-9][0-9A-Z]{5,11})\b/g;

/** VAT-ish keywords across this task's six target languages (+ Spanish/Portuguese `NIF`, thrown
 *  in for free since the pattern already covers the Iberian peninsula's own `IVA`). A line
 *  matching one of these is preferred over a bare shape match elsewhere in the document — see this
 *  file's own header on the IBAN false-positive risk this exists to reduce. */
const VAT_CONTEXT_RE = /\b(TVA|VAT|IVA|U\.?St|MwSt|NIP|BTW|NIF)\b/i;

function extractVatIdFromLine(line: string): string | undefined {
  VAT_ID_SHAPE_RE.lastIndex = 0; // stateful global regex — reset before every independent scan
  for (const match of line.matchAll(VAT_ID_SHAPE_RE)) {
    const prefix = match[1].toUpperCase();
    if (EU_VAT_PREFIXES.has(prefix)) return prefix + match[2].toUpperCase();
  }
  return undefined;
}

function findVatId(lines: string[]): string | undefined {
  const withoutIban = lines.filter((line) => !/IBAN/i.test(line));
  for (const line of withoutIban) {
    if (VAT_CONTEXT_RE.test(line)) {
      const found = extractVatIdFromLine(line);
      if (found) return found;
    }
  }
  // Fallback: no keyword-anchored hit anywhere — still IBAN-excluded, but otherwise a bare shape
  // match anywhere in the document. The weakest of this file's heuristics, documented as such
  // above.
  for (const line of withoutIban) {
    const found = extractVatIdFromLine(line);
    if (found) return found;
  }
  return undefined;
}

/** A run of digits/separators that starts AND ends on a digit — deliberately not a strict
 *  "N thousands-groups of exactly 3" pattern (real OCR output is noisy enough that a stricter
 *  regex would miss more than it would reject); `parseAmount` below carries the actual
 *  grouping/decimal-separator judgement call. */
const NUMBER_TOKEN_RE = /\d[\d.,\s]*\d|\d/g;

/**
 * European invoices mix `1.234,56` (dot=thousands, comma=decimal) and `1,234.56` (comma=thousands,
 * dot=decimal) freely depending on locale — this never tries to detect locale, it infers from
 * SHAPE alone: whichever separator appears LAST is the decimal point (the other is stripped as a
 * thousands grouping); when only one kind of separator appears, a final group of 1-2 digits reads
 * as a decimal fraction (`200,00` -> 200.00, `45,5` -> 45.5), a final group of exactly 3+ digits
 * reads as a thousands grouping instead (`12.345` -> 12345). Genuinely ambiguous for some inputs
 * (a bare `12.345` COULD mean twelve-point-three-four-five) — one more honest weak spot, harmless
 * here since a wrong guess only ever lands on an EDITABLE proposal field.
 */
function parseAmount(raw: string): number | undefined {
  let normalized = raw.trim().replace(/[€$£]/g, '').replace(/\s/g, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma || hasDot) {
    const separator = hasComma ? ',' : '.';
    const parts = normalized.split(separator);
    normalized =
      parts[parts.length - 1].length <= 2
        ? `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`
        : parts.join('');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** The LAST number-shaped token on a matching line — invoices overwhelmingly print
 *  "<label>: <amount> <currency>", so the amount trails the label; taking the last token also
 *  survives a leading item count/quantity earlier on the same line. */
function lastAmountOnLine(line: string): number | undefined {
  const tokens = [...line.matchAll(NUMBER_TOKEN_RE)];
  if (tokens.length === 0) return undefined;
  return parseAmount(tokens[tokens.length - 1][0]);
}

/** Keyword sets across this task's six target languages. Checked in this exact priority order per
 *  line — VAT before NET before GROSS — because "Total TVA" and "Total HT" both also contain the
 *  generic word "Total" (`GROSS_RE`'s own pattern); without an order, both would misclassify as a
 *  gross/TOTAL line. `GROSS_RE`'s trailing bare `TOTAL` is deliberately the least specific keyword
 *  of the three sets — kept last in ITS OWN alternation for readability only, since ordering
 *  within `GROSS_RE` does not matter (nothing here overlaps NET/VAT once those are checked first
 *  and skipped). */
const NET_RE = /\b(HT|NET|NETTO|IMPONIBILE|SUBTOTAL|NETTOBETRAG)\b/i;
const VAT_RE = /\b(TVA|VAT|BTW|MWST|IVA|U\.?ST)\b/i;
const GROSS_RE = /\b(TTC|TOTAAL|TOTALE|GESAMTBETRAG|GESAMT|RAZEM|GRAND\s+TOTAL|AMOUNT\s+DUE|TOTAL)\b/i;

interface Totals {
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
}

/** Scans every line once, classifying each against VAT/NET/GROSS in that priority order (first
 *  match wins per line — a line is never double-counted), keeping the LAST matching line per
 *  category found in the whole document: a real invoice's per-line subtotals (if OCR'd at all)
 *  come before the final totals block, so "last wins" favours the actual footer totals over any
 *  earlier partial sum sharing the same keyword. */
function findTotals(lines: string[]): Totals {
  const totals: Totals = {};
  for (const line of lines) {
    if (VAT_RE.test(line)) {
      const amount = lastAmountOnLine(line);
      if (amount !== undefined) totals.vatAmount = amount;
    } else if (NET_RE.test(line)) {
      const amount = lastAmountOnLine(line);
      if (amount !== undefined) totals.netAmount = amount;
    } else if (GROSS_RE.test(line)) {
      const amount = lastAmountOnLine(line);
      if (amount !== undefined) totals.grossAmount = amount;
    }
  }
  return totals;
}

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/** `DD` `MM` `YYYY` separated by `/`, `.`, or `-` — assumed DAY-MONTH-YEAR order (never
 *  MONTH-DAY-YEAR): this task's own six target languages are all day-first locales; a US-style
 *  `MM/DD/YYYY` invoice would be silently misread (e.g. `03/04/2026` read as 3 April, not 4 March)
 *  — one more honest gap, not handled. */
const EU_DATE_RE = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/;
/** Issuance-related keywords across this task's six target languages, used only to PREFER a date
 *  line over the document-order fallback below — a due date/payment-terms date printed earlier in
 *  the text would otherwise be picked instead of the real issue date. */
const DATE_CONTEXT_RE = /\b(DATE|DATUM|DATA|FECHA|EMISSION|ÉMISSION|WYSTAWIENIA|UITGIFTE)\b/i;

function extractDateFromLine(line: string): string | undefined {
  const iso = ISO_DATE_RE.exec(line);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = EU_DATE_RE.exec(line);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, '0')}-${eu[1].padStart(2, '0')}`;
  return undefined;
}

function findIssueDate(lines: string[]): string | undefined {
  for (const line of lines) {
    if (DATE_CONTEXT_RE.test(line)) {
      const found = extractDateFromLine(line);
      if (found) return found;
    }
  }
  for (const line of lines) {
    const found = extractDateFromLine(line);
    if (found) return found;
  }
  return undefined;
}

/** Document-title words this task's six target languages use for "invoice"/"quote" — a keyword
 *  ANYWHERE before the invoice number itself, never required to be the whole line, so
 *  "FACTURE N. INV-2026-0042" is matched by the "FACTURE" branch even though the line carries
 *  more than just that one word. */
const INVOICE_NUMBER_RE =
  /(?:FACTURE|INVOICE|RECHNUNG|FATTURA|FAKTUR[AY]?|FACTUUR)\s*(?:NUMBER|NUMMER|NR\.?|NO\.?|N[°.]?|#)?\s*[:.-]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i;

function findSupplierNumber(text: string): string | undefined {
  const match = INVOICE_NUMBER_RE.exec(text);
  return match ? match[1].replace(/[.:]+$/, '') : undefined;
}

/** Generic invoice/quote title words — skipped so the supplier-name heuristic below does not pick
 *  the document's own title as if it were the seller's name. */
const GENERIC_DOCUMENT_TITLE_RE = /^(facture|invoice|fattura|factuur|faktura|rechnung|devis|quote)s?\b/i;

/** THE weakest heuristic in this file (see this file's own header): the first non-blank OCR'd line
 *  that (a) does not start with a digit (rules out an address's own house number, a date, an
 *  amount) and (b) is not itself just the document's own title word. No layout/font-size
 *  awareness at all — a letterhead logo, a page header, or any decorative first line defeats this
 *  outright. */
function findSupplier(lines: string[]): string | undefined {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\d/.test(line)) continue;
    if (GENERIC_DOCUMENT_TITLE_RE.test(line)) continue;
    return line;
  }
  return undefined;
}

/** Builds keys ONLY for fields actually found — never an explicit `undefined` value — mirroring
 *  `mistral-client.ts`'s own `setIfDefined` discipline one file up, for the identical downstream
 *  reason (`Object.keys`/spread-based consumers on the frontend must never see a phantom key). */
export function mapOcrTextToProposal(text: string): ExtractedInvoiceProposal {
  const lines = text.split(/\r?\n/);
  const totals = findTotals(lines);
  const fields: ExtractedInvoiceProposal['fields'] = {};

  const supplier = findSupplier(lines);
  if (supplier !== undefined) fields.supplier = supplier;

  const supplierVatId = findVatId(lines);
  if (supplierVatId !== undefined) fields.supplierVatId = supplierVatId;

  const supplierNumber = findSupplierNumber(text);
  if (supplierNumber !== undefined) fields.supplierNumber = supplierNumber;

  const issueDate = findIssueDate(lines);
  if (issueDate !== undefined) fields.issueDate = issueDate;

  if (totals.netAmount !== undefined) fields.netAmount = totals.netAmount;
  if (totals.vatAmount !== undefined) fields.vatAmount = totals.vatAmount;
  if (totals.grossAmount !== undefined) fields.grossAmount = totals.grossAmount;

  // No `currency`/`lines` extraction — see this file's own header: this heuristic stops at the
  // fields this task explicitly asked for (amounts/date/number/VAT id/supplier name). Per-line
  // item detail from unstructured OCR text would need actual table/column recognition this plain
  // regex approach cannot honestly provide — left absent rather than guessed.
  return { fields };
}

export interface LocalOcrClientConfig {
  /** The local engine's own base URL (e.g. `http://tika:9998` in `docker-compose.yml`'s own
   *  `ocr-local` profile) — this client is Tika-shaped (`PUT {baseUrl}/tika`), see this file's own
   *  header for why Tika specifically was chosen. */
  baseUrl: string;
  timeoutMs?: number;
}

export interface LocalOcrClient {
  extract(bytes: Uint8Array, mime: string): Promise<ExtractedInvoiceProposal>;
}

export function buildLocalOcrClient(config: LocalOcrClientConfig): LocalOcrClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async extract(bytes, mime) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/tika`, {
          method: 'PUT',
          headers: { 'content-type': mime, accept: 'text/plain' },
          body: Buffer.from(bytes),
          signal: controller.signal,
        });
      } catch (err) {
        // Same "AbortError is not `instanceof Error` in Node" check `mistral-client.ts` already
        // relies on one file up — see that file's own comment on `withTimeout`.
        if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
          throw new LocalOcrTimeoutError(timeoutMs);
        }
        throw new LocalOcrError(
          `Local OCR engine request failed (${baseUrl}): ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      if (!res.ok) {
        throw new LocalOcrError(
          `Local OCR engine request failed (HTTP ${res.status}): ${text.slice(0, 300)}`,
          res.status,
        );
      }

      return mapOcrTextToProposal(text);
    },
  };
}

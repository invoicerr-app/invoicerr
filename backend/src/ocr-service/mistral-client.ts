/**
 * Mistral Document AI (OCR) — bare `fetch` HTTP client, no SDK (`@mistralai/mistralai` was
 * deliberately NOT added — root instruction: no new npm dependency for this task; `fetch` is
 * native since Node 18, this backend's own minimum). Every fact below is either VERIFIED (this
 * task's own `curl`, or a verbatim quote off `docs.mistral.ai`, both cited) or explicitly marked
 * EXTRAPOLATED — the same "cite, don't invent" discipline `nav-client.ts`'s own header holds.
 *
 * ## Lives here, not in `backend/src/plugins/` — MANDANT AMENDMENT (mid-task)
 *
 * This client is used by exactly ONE caller: `ocr-server.ts`, the entrypoint for a THIRD container
 * role (`ROLE=ocr`, alongside the existing `api`/`worker`) that is the ONLY thing in this whole
 * deployment that ever holds `MISTRAL_API_KEY` — never the main backend or its database. The main
 * backend's OWN "plugin" (`plugins/ocr/providers/mistral/mistral.ts`, still what implements
 * `ReceivedDocumentExtractor` and registers into the core's extension point — see that file's own
 * header) is a THIN HTTP CLIENT of the `ROLE=ocr` service, not of Mistral directly — this file, and
 * the real Mistral credential, never cross that boundary.
 *
 * ## VERIFIED — endpoint, auth, request shape (docs.mistral.ai/api/endpoint/ocr, docs.mistral.ai/
 * capabilities/OCR/basic_ocr/ — fetched 2026-09-03)
 *
 *  - `POST https://api.mistral.ai/v1/ocr`, `Authorization: Bearer $MISTRAL_API_KEY`,
 *    `Content-Type: application/json`.
 *  - A LOCAL file (never hosted at a public URL — this backend only ever has raw bytes) is passed
 *    as a base64 DATA URI in `document.document_url`, quoted VERBATIM from the docs' own "Base64
 *    Encoded PDF" example:
 *    `{"document":{"type":"document_url","document_url":"data:application/pdf;base64,<base64_pdf>"}}`
 *    — the SAME `type: "document_url"` field the docs' own plain-URL example uses, just with a
 *    `data:` URI instead of an `https://` one; there is no separate "upload" step for this shape.
 *  - Structured field extraction: `document_annotation_format` — a `{type: "json_schema",
 *    json_schema: {schema, name, strict}}` wrapper, quoted VERBATIM from `docs.mistral.ai/
 *    capabilities/OCR/annotations/`'s own curl example (a DIFFERENT schema there — chapter titles
 *    of a paper — the WRAPPER shape is what is cited, `INVOICE_ANNOTATION_JSON_SCHEMA` below is
 *    this task's own schema, not a Mistral-provided one: no invoice-specific example was available
 *    to quote).
 *
 * ## VERIFIED — response shape
 *
 *  - Top-level: `pages` (array — `index`/`markdown`/`images`/`dimensions`/…), `model`,
 *    `document_annotation`, `usage_info`. Quoted structure from `docs.mistral.ai/capabilities/OCR/
 *    basic_ocr/`'s own documented response object.
 *  - `document_annotation` is a JSON-ENCODED STRING, not a nested object — verified against the
 *    docs' own worked example response: `"document_annotation": "{\n\"language\": \"English\",
 *    ...}"`. `mapMistralResponseToProposal` below `JSON.parse()`s it for exactly this reason;
 *    `mistral-client.spec.ts`'s own fixture is that exact captured shape, narrowed to this task's
 *    own schema.
 *
 * ## VERIFIED, LIVE, CREDENTIAL-FREE (this task's own `curl`, 2026-09-03)
 *
 *    `curl -X POST https://api.mistral.ai/v1/ocr -H "Content-Type: application/json" -d '{...}'`
 *    (no Authorization header at all, AND with an obviously-fake bearer token) both answer
 *    `HTTP 401` with body `{"detail":"Invalid API Key"}` — this is what `MistralOcrError`'s own 401
 *    branch below is checked against (`mistral-client.spec.ts`), and what `mistral.live.spec.ts`'s
 *    own credential-free reachability block re-proves against the real API.
 *
 * ## EXTRAPOLATED — not verified against a real response
 *
 *  - The exact JSON body of a 429 (rate limit/quota) response — no key was available to trigger one
 *    for real. `MistralOcrError`'s 429 branch below only relies on the HTTP STATUS CODE (a
 *    standard, provider-agnostic signal), never on parsing a provider-specific body shape for this
 *    one case — see that class's own comment.
 */
import { ExtractedInvoiceProposal } from '@/modules/documents/received-invoices/ocr/extractor';

export const MISTRAL_OCR_DEFAULT_BASE_URL = 'https://api.mistral.ai';
const MISTRAL_OCR_MODEL = 'mistral-ocr-latest';
const DEFAULT_TIMEOUT_MS = 60_000;

/** A NAMED error for every failure mode this client can produce — never a bare, unlabelled `Error`,
 *  per this task's own root instruction ("les erreurs du provider... sont NOMMÉES, jamais
 *  avalées"). `status` is present for every HTTP-level failure (absent only for a timeout or a
 *  network-level failure, where there IS no HTTP status). */
export class MistralOcrError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'MistralOcrError';
  }
}

export class MistralOcrTimeoutError extends MistralOcrError {
  constructor(timeoutMs: number) {
    super(`Mistral OCR request timed out after ${timeoutMs}ms.`);
    this.name = 'MistralOcrTimeoutError';
  }
}

/**
 * This task's OWN JSON Schema for the fields `received-invoices/ocr/extractor.ts`'s
 * `ExtractedInvoiceProposal` needs — see this file's own header: the OUTER `document_annotation_
 * format` wrapper syntax is cited from Mistral's docs, this inner schema is not. Every property is
 * nullable (`["string", "null"]`/`["number", "null"]`) but still listed in `required` — the
 * standard "always present, possibly null" structured-output convention (never OMITTED: `strict:
 * true` structured outputs require every property to be in `required`), which is what lets a
 * genuinely blank invoice field come back as an explicit `null` rather than making the WHOLE
 * response fail schema validation.
 */
const INVOICE_ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  title: 'ReceivedInvoiceOcrExtraction',
  properties: {
    supplier: { type: ['string', 'null'], description: "The seller/supplier's name as printed." },
    supplierVatId: {
      type: ['string', 'null'],
      description: "The supplier's own VAT identifier, if printed.",
    },
    supplierNumber: { type: ['string', 'null'], description: 'The invoice number assigned by the supplier.' },
    issueDate: { type: ['string', 'null'], description: 'The invoice issue date, formatted YYYY-MM-DD.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 currency code, e.g. EUR.' },
    netAmount: { type: ['number', 'null'], description: 'Total amount excluding VAT.' },
    vatAmount: { type: ['number', 'null'], description: 'Total VAT amount.' },
    grossAmount: { type: ['number', 'null'], description: 'Total amount including VAT.' },
    lines: {
      type: 'array',
      description: 'Each line item on the invoice.',
      items: {
        type: 'object',
        properties: {
          description: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unitPrice: { type: ['number', 'null'], description: 'The unit price, excluding VAT.' },
          vatRate: { type: ['string', 'null'], description: 'The VAT rate applied to this line, e.g. "20".' },
        },
        required: ['description', 'quantity', 'unitPrice', 'vatRate'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'supplier',
    'supplierVatId',
    'supplierNumber',
    'issueDate',
    'currency',
    'netAmount',
    'vatAmount',
    'grossAmount',
    'lines',
  ],
  additionalProperties: false,
};

/** The exact request body — see this file's own header for what is cited vs. this task's own. */
function buildRequestBody(base64: string, mime: string): Record<string, unknown> {
  return {
    model: MISTRAL_OCR_MODEL,
    document: { type: 'document_url', document_url: `data:${mime};base64,${base64}` },
    document_annotation_format: {
      type: 'json_schema',
      json_schema: {
        schema: INVOICE_ANNOTATION_JSON_SCHEMA,
        name: 'received_invoice_extraction',
        strict: true,
      },
    },
  };
}

/** One raw line, as `document_annotation`'s own parsed JSON carries it — every field nullable, per
 *  this file's own schema comment. */
interface RawAnnotationLine {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  vatRate: string | null;
}

interface RawAnnotation {
  supplier: string | null;
  supplierVatId: string | null;
  supplierNumber: string | null;
  issueDate: string | null;
  currency: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
  lines: RawAnnotationLine[] | null;
}

/** `undefined` for `null`/absent — `ExtractedInvoiceProposal`'s own fields are OPTIONAL, never
 *  explicitly `null` (see `extraction.ts`'s own header: "a line missing one fact is still a real
 *  line" — the SAME "omit, don't emit null" convention this maps into, for identical downstream
 *  consumers: `supplier-reconciliation.ts`/`line-totals-check.ts` both already only ever check
 *  `typeof x === 'string'`/`typeof x === 'number'`, never `x !== null`). */
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

/**
 * `response.document_annotation` is a JSON-ENCODED STRING (see this file's own header) — parsed
 * here, never trusted as already-structured. `null`/unparseable/absent all degrade to an EMPTY
 * proposal (`{fields: {}}`) rather than throwing: a provider that could not extract anything
 * structured from a given page is not a CLIENT error, it is the same honest "nothing extractable"
 * outcome `extraction.ts`'s own `EMPTY_RESULT` already holds for a plain scanned page with no
 * embedded XML.
 */
export function mapMistralResponseToProposal(response: {
  document_annotation?: string | null;
}): ExtractedInvoiceProposal {
  if (!response.document_annotation) return { fields: {} };

  let raw: RawAnnotation;
  try {
    raw = JSON.parse(response.document_annotation);
  } catch {
    return { fields: {} };
  }

  // Built key-by-key (never a plain object literal with `undefined` values) so a null/absent field
  // is truly OMITTED from `fields` — `{a: undefined}` and `{}` compare equal under `toEqual`, but
  // NOT under `toHaveProperty`/`Object.keys`, and downstream code (`buildInitialData` on the
  // frontend, `field-kinds.ts`'s form rendering) reads `Object.keys`/spreads this object directly —
  // an explicit `undefined` value would still show up there, unlike a genuinely absent key.
  const fields: ExtractedInvoiceProposal['fields'] = {};
  const setIfDefined = <K extends keyof ExtractedInvoiceProposal['fields']>(
    key: K,
    value: ExtractedInvoiceProposal['fields'][K] | null | undefined,
  ) => {
    const resolved = orUndefined(value);
    if (resolved !== undefined) fields[key] = resolved;
  };

  setIfDefined('supplier', raw.supplier);
  setIfDefined('supplierVatId', raw.supplierVatId);
  setIfDefined('supplierNumber', raw.supplierNumber);
  setIfDefined('issueDate', raw.issueDate);
  setIfDefined('currency', raw.currency);
  setIfDefined('netAmount', raw.netAmount);
  setIfDefined('vatAmount', raw.vatAmount);
  setIfDefined('grossAmount', raw.grossAmount);
  if (raw.lines && raw.lines.length > 0) {
    fields.lines = raw.lines.map((line) => ({
      description: orUndefined(line.description),
      quantity: orUndefined(line.quantity),
      unitPrice: orUndefined(line.unitPrice),
      vatRate: orUndefined(line.vatRate),
    }));
  }

  return { fields };
}

export interface MistralOcrClientConfig {
  apiKey: string;
  /** Override for tests (`client.spec.ts`'s own real `node:http` stub) — defaults to the real API. */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface MistralOcrClient {
  /** POST /v1/ocr with the given document, mapped straight to a proposal — see
   *  `mapMistralResponseToProposal`'s own header for the response shape. Throws `MistralOcrError`
   *  (or `MistralOcrTimeoutError`) for every failure mode, never a bare/unlabelled error. */
  extract(bytes: Uint8Array, mime: string): Promise<ExtractedInvoiceProposal>;
}

export function buildMistralOcrClient(config: MistralOcrClientConfig): MistralOcrClient {
  const baseUrl = config.baseUrl ?? MISTRAL_OCR_DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } catch (err) {
      // A timed-out `fetch` rejects with a `DOMException` named "AbortError" — NOT an `instanceof
      // Error` in Node (DOMException is a separate Web API class, confirmed empirically against
      // this backend's own Node runtime) — checked by `.name` alone for exactly that reason.
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        throw new MistralOcrTimeoutError(timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Named per HTTP status where a distinct, actionable message earns its keep (401/429 — this
   *  task's own required cases); every other non-2xx falls back to a generic, still-NAMED message
   *  carrying the real status and a truncated body, exactly the pattern `nav-client.ts`'s own
   *  `postNavXml` already uses for its own "malformed/misrouted request" case. */
  async function throwForStatus(status: number, bodyText: string): Promise<never> {
    if (status === 401) {
      throw new MistralOcrError(`Invalid Mistral API key (401): ${bodyText.slice(0, 200)}`, 401);
    }
    if (status === 429) {
      throw new MistralOcrError(
        `Mistral OCR quota or rate limit exceeded (429): ${bodyText.slice(0, 200)}`,
        429,
      );
    }
    throw new MistralOcrError(
      `Mistral OCR request failed (HTTP ${status}): ${bodyText.slice(0, 300)}`,
      status,
    );
  }

  return {
    async extract(bytes, mime) {
      const base64 = Buffer.from(bytes).toString('base64');
      const body = buildRequestBody(base64, mime);

      let res: Response;
      try {
        res = await withTimeout((signal) =>
          fetch(`${baseUrl}/v1/ocr`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify(body),
            signal,
          }),
        );
      } catch (err) {
        if (err instanceof MistralOcrError) throw err; // timeout, already named above
        throw new MistralOcrError(
          `Mistral OCR request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const text = await res.text();
      if (!res.ok) await throwForStatus(res.status, text);

      let parsed: { document_annotation?: string | null };
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new MistralOcrError(`Mistral OCR returned a non-JSON response: ${text.slice(0, 300)}`);
      }

      return mapMistralResponseToProposal(parsed);
    },
  };
}

/**
 * TODO_PRODUIT.md T5(c) — the composition between the EXISTING structural reader (`extraction.ts`,
 * T5(a)/T5(b)) and the OCR extension point (`extractor.ts`): OCR is a FALLBACK, tried only when a
 * PDF carried nothing structural at all ("l'OCR des PDF reçus non structurés" — the task's own
 * title). A structured deposit (CII/UBL/Factur-X) never reaches this function's own extractor call
 * at all — this is what guarantees a working Factur-X deposit can never be second-guessed by OCR,
 * and that OCR is never even attempted for a non-PDF file (an XML upload has nothing an OCR provider
 * could read anyway).
 *
 * Lives in `received-invoices/ocr/`, not `received-invoices.service.ts` itself, so it can be unit
 * tested in isolation against a STUB `ReceivedDocumentExtractor` — proving the four outcomes below
 * without a real plugin, a real Prisma row, or a real HTTP call anywhere in the chain.
 */
import { ExtractionResult } from '../extraction';
import { ExtractorNotReadyError, receivedDocumentExtractorRegistry } from './extractor';

/**
 * The four honest outcomes a deposit's OCR attempt can land on — surfaced verbatim in
 * `UploadReceivedInvoicePreview.ocr` (`received-invoices.service.ts`) for the frontend to render:
 *  - `not-attempted`: OCR was never even tried — either structural extraction already succeeded, or
 *    this file is not a PDF at all. The ordinary case for every CII/UBL/Factur-X deposit.
 *  - `unavailable`: a PDF WITH NOTHING STRUCTURAL was found, and OCR was tried but nothing could
 *    answer — no extractor registered, or a registered one declined (`ExtractorNotReadyError`, e.g.
 *    a plugin toggled off or unconfigured). Deliberately the SAME outcome for both cases: the screen
 *    only ever needs to say "no OCR available, fill in by hand" — see this task's own root
 *    instruction, "absence honnête, jamais un échec silencieux", never a distinction the user could
 *    not act on differently anyway.
 *  - `extracted`: an extractor answered — `fields` (the caller's own, already merged) came, at least
 *    in part, from OCR. `extractorId` names WHICH one, for observability.
 *  - `failed`: an extractor was tried and THREW something other than `ExtractorNotReadyError` — a
 *    real provider error (quota, invalid key, timeout, a malformed response). NEVER swallowed: the
 *    message is the provider's own (or this client's own named wrapper around it — see
 *    `plugins/ocr/providers/mistral/client.ts`), always surfaced to the screen.
 */
export type OcrOutcome =
  | { outcome: 'not-attempted' }
  | { outcome: 'unavailable' }
  | { outcome: 'extracted'; extractorId: string }
  | { outcome: 'failed'; extractorId: string; message: string };

export interface OcrFallbackResult {
  /** `structural.syntax` unchanged when OCR was not attempted or did not answer; `'OCR'` once an
   *  extractor's proposal was merged in — a NEW value alongside `extraction.ts`'s own
   *  `RecognizedSyntax` ('CII'/'UBL'/'FACTURX_CII'/null), deliberately not added to that type itself:
   *  `extraction.ts` stays a pure structural reader with no notion of OCR at all (see this core's own
   *  header, "the core has zero cloud dependency") — this string only ever exists at THIS
   *  composition layer, in the upload preview response. */
  syntax: string | null;
  fields: ExtractionResult['fields'];
  ocr: OcrOutcome;
}

/** A PDF, by mime OR filename — the exact same two-signal check `extraction.ts`'s own
 *  `extractReceivedInvoiceFields` already uses for `looksLikePdf` (deliberately duplicated here
 *  rather than exported from that file: this is a one-line, stable predicate, and keeping it here
 *  avoids widening that file's own public surface for a single caller — see this task's own
 *  root instruction to prefer the minimal touch to an already-shipped, heavily-commented file). */
function looksLikePdf(mime: string, fileName: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(fileName);
}

/**
 * Applies the OCR fallback on top of whatever `extraction.ts` already read. Never throws — every
 * failure mode (no extractor, a declined extractor, a provider error) is folded into `OcrOutcome`
 * for the caller to surface, exactly the same "a document with nothing extractable is still a valid,
 * honest outcome" discipline `extraction.ts`'s own header holds for structural extraction.
 */
export async function applyOcrFallback(
  structural: ExtractionResult,
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): Promise<OcrFallbackResult> {
  if (structural.syntax !== null || !looksLikePdf(mime, fileName)) {
    return { syntax: structural.syntax, fields: structural.fields, ocr: { outcome: 'not-attempted' } };
  }

  // Normalized to the real mime once `looksLikePdf` has already decided (by mime OR filename) that
  // this IS a PDF — an extractor only ever declares `supports('application/pdf')`, never a filename
  // pattern, so a generic/wrong upload mime on an otherwise-clearly-`.pdf` file must not silently
  // defeat resolution the same way a `.xml` extension never defeats `extraction.ts`'s own Factur-X
  // detection (that file's own `looksLikePdf` local, mirrored here).
  const effectiveMime = 'application/pdf';
  const extractor = receivedDocumentExtractorRegistry.resolveFor(effectiveMime);
  if (!extractor) {
    return { syntax: null, fields: structural.fields, ocr: { outcome: 'unavailable' } };
  }

  try {
    const proposal = await extractor.extract(bytes, effectiveMime);
    return {
      syntax: 'OCR',
      fields: { ...structural.fields, ...proposal.fields },
      ocr: { outcome: 'extracted', extractorId: extractor.id },
    };
  } catch (err) {
    if (err instanceof ExtractorNotReadyError) {
      return { syntax: null, fields: structural.fields, ocr: { outcome: 'unavailable' } };
    }
    return {
      syntax: null,
      fields: structural.fields,
      ocr: {
        outcome: 'failed',
        extractorId: extractor.id,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

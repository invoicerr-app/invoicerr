/**
 * The OCR provider as seen from the main backend: a thin client of the OCR ENGINE container
 * (`ghcr.io/invoicerr-app/ocr-image`, ocrmypdf plus this product's Tesseract language packs).
 *
 * ## Why this talks to the engine directly
 *
 * There used to be a container in between: a third role of this same image (`ROLE=ocr`,
 * `ocr-server.ts`) that this backend called over HTTP, which then called the engine. That hop
 * existed for exactly one reason — it was the only process allowed to hold `MISTRAL_API_KEY`, so
 * that a cloud credential never reached the backend or its database. With the Mistral engine gone
 * there is no credential to isolate, and the hop was a container whose whole job was to forward a
 * request and call a pure function. Both are gone: the engine does OCR, this backend does the rest.
 *
 * ## What "the rest" is
 *
 * The engine returns plain text. Turning that text into invoice fields is
 * `ocr-service/local-client.ts`'s `mapOcrTextToProposal` — heuristics over VAT ids, totals, dates
 * and supplier lines, which belong with the invoice code they serve and are unit-tested alongside
 * it. `buildLocalOcrClient` already composes the two, so this class is the registration shim and
 * the error mapping, nothing more.
 *
 * ## Absent vs. broken
 *
 * `OCR_SERVICE_URL` unset is not a failure: it is the self-hosted default, no OCR container
 * deployed, a scanned PDF stored with empty fields for a human to fill in. That case throws
 * `ExtractorNotReadyError`, which `apply-ocr-fallback.ts` treats as the honest "no extractor"
 * outcome. Once the variable IS set, an unreachable or misbehaving engine is a real, named failure
 * and never silently degrades to the same thing.
 *
 * The core (`received-invoices/`) never imports this file. It knows only the extension point
 * (`received-invoices/ocr/extractor.ts`); `plugins/index.ts` does the registering.
 */
import {
  ExtractedInvoiceProposal,
  ExtractorNotReadyError,
  ReceivedDocumentExtractor,
} from '@/modules/documents/received-invoices/ocr/extractor';
import { buildLocalOcrClient, LocalOcrError, LocalOcrTimeoutError } from '@/ocr-service/local-client';

export class LocalOcrProvider implements ReceivedDocumentExtractor {
  id = 'local-ocr';

  supports(mime: string): boolean {
    return mime === 'application/pdf';
  }

  /** The readiness hint `received-invoices/ocr/extractor.ts#ReceivedDocumentExtractor.isConfigured`
   *  declares — the SAME "is `OCR_SERVICE_URL` set" check `extract()` below already runs, just without
   *  the round trip: `received-invoices.service.ts#upload` calls this BEFORE deciding whether to
   *  enqueue a background OCR job at all, so an instance with nothing configured stays on the exact
   *  synchronous path it always had, rather than enqueueing a job whose own `extract()` would just
   *  throw `ExtractorNotReadyError` a moment later anyway. */
  isConfigured(): boolean {
    return Boolean(process.env.OCR_SERVICE_URL?.trim());
  }

  async extract(bytes: Uint8Array, mime: string): Promise<ExtractedInvoiceProposal> {
    const serviceUrl = process.env.OCR_SERVICE_URL?.trim();
    if (!serviceUrl) {
      throw new ExtractorNotReadyError(
        this.id,
        'No OCR engine is configured for this instance (OCR_SERVICE_URL is not set) — the honest, ' +
          'self-host-by-default outcome. See docker-compose.yml\'s own "ocr" service.',
      );
    }

    try {
      return await buildLocalOcrClient({ baseUrl: serviceUrl }).extract(bytes, mime);
    } catch (err) {
      // Both are re-thrown as plain errors carrying the engine's own message: the caller
      // distinguishes "no extractor" from "extraction failed" by TYPE, and only the unset-URL case
      // above is the former. A timeout or an HTTP error from an engine the operator did deploy is
      // squarely the latter.
      if (err instanceof LocalOcrTimeoutError || err instanceof LocalOcrError) {
        throw new Error(`OCR engine request failed (${serviceUrl}): ${err.message}`);
      }
      throw err;
    }
  }
}

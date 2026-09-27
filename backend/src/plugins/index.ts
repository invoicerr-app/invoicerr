import { Injectable, Module, OnModuleInit } from '@nestjs/common';

import { FakeReceivedInvoiceOcrExtractor } from '@/modules/documents/received-invoices/ocr/fake-extractor';
import { receivedDocumentExtractorRegistry } from '@/modules/documents/received-invoices/ocr/extractor';
import { LocalOcrProvider } from './ocr/providers/local/local';

/**
 * The composition root for this codebase's one remaining extension point: received-invoice OCR.
 *
 * This directory used to also be the composition root for `PluginRegistry`/`PluginType` — an
 * instance-wide, DB-backed, Settings-configurable mechanism with two categories that were EVER
 * actually registered: `SIGNING` (dead since quote e-signature was removed) and `STORAGE` (a
 * `local`/`s3` choice for broadcasting a signed quote or paid invoice PDF to a public URL, itself
 * never wired to anything the app actually does — the upload helpers it fed,
 * `uploadSignedQuotePdf`/`uploadPaidInvoicePdf`, had no call site of their own). Removed wholesale
 * (2026-09-17, owner decision): a company-level S3 storage plugin is not a product this app offers
 * any more — periodic backup of every document is an INSTANCE-level concern
 * (`backend/src/modules/backup/`), never a per-deployment toggle a tenant admin can point at their
 * own bucket. `backend/src/modules/documents/archive/s3-storage.ts` (`ARCHIVE_STORAGE=s3`) is
 * unrelated and unaffected — see that file's own header.
 *
 * OCR never went through any of that: its whole configuration is one environment variable,
 * `OCR_SERVICE_URL`, naming a container — never a `Plugin` database row, never a Settings screen.
 * The core (`received-invoices/`) never imports the provider below directly, only the narrow
 * extension point it declares (`received-invoices/ocr/extractor.ts`) — this file is the one place
 * that is allowed to import both sides and wire them together.
 */
function registerOcrExtractor(): void {
  if (process.env.NODE_ENV === 'test') {
    // Deterministic, network-free stand-in — see `FakeReceivedInvoiceOcrExtractor`'s own header for
    // why Cypress can exercise "PDF -> pre-filled OCR proposal" through a real browser with no OCR
    // engine anywhere in the test stack.
    receivedDocumentExtractorRegistry.register(new FakeReceivedInvoiceOcrExtractor());
  } else {
    receivedDocumentExtractorRegistry.register(new LocalOcrProvider());
  }
}

@Injectable()
class OcrExtractorBootstrap implements OnModuleInit {
  // Guards against a SECOND app bootstrap in the same Node process (e.g. more than one Nest testing
  // module built inside one Jest worker) hitting `receivedDocumentExtractorRegistry.register`'s own
  // "already registered" throw — the registry is a plain module-level singleton, not re-created per
  // Nest application instance, so `onModuleInit` running twice in one process is a real case, not a
  // hypothetical one.
  private static registered = false;

  onModuleInit(): void {
    if (OcrExtractorBootstrap.registered) return;
    OcrExtractorBootstrap.registered = true;
    registerOcrExtractor();
  }
}

/**
 * Registered in BOTH `AppModule` (the API process) AND `WorkerModule` (`src/worker.module.ts`, the
 * dedicated `ROLE=worker` process) — `received-invoices.module.ts` never imports this module itself,
 * staying blind to which provider (or fake) backs the extension point, exactly as its own header
 * describes. `OcrExtractorBootstrap`'s own `registered` guard (below) is what makes importing it from
 * TWO independent root modules safe rather than a double-registration crash.
 *
 * OCR used to be reachable ONLY from the API process, synchronously, inside `upload()` — no longer
 * true: an upload whose OCR is handed off to the `received-invoice-ocr` BullMQ queue
 * (`received-invoices/ocr/ocr-queue.constants.ts`) has that job's own extractor CALL happen inside
 * `run-ocr-job.ts`, running in whichever process actually consumes that queue (the API inline by
 * default, or a dedicated worker when `WORKER_INLINE=false`) — see
 * `queue/document-queue-worker.module.ts`'s own header on `ReceivedInvoiceOcrProcessor`. Without this
 * module registered in `WorkerModule` too, a scaled deployment's dedicated worker would resolve NO
 * extractor at all and every OCR job would silently land on `{ outcome: 'unavailable' }` regardless of
 * how OCR is actually configured.
 */
@Module({ providers: [OcrExtractorBootstrap] })
export class OcrExtractorModule {}

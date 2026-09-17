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
 * Registered directly in `AppModule` — `received-invoices.module.ts` never imports this module
 * itself, staying blind to which provider (or fake) backs the extension point, exactly as its own
 * header describes. Not part of `DocumentsCoreModule`/the queue worker: received-invoice upload and
 * its OCR fallback are an HTTP-only, synchronous flow (`ReceivedInvoicesController`), never reached
 * from the BullMQ worker process.
 */
@Module({ providers: [OcrExtractorBootstrap] })
export class OcrExtractorModule {}

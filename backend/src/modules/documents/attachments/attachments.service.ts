/**
 * Enriched expense categories ("notes de frais enrichies") — the backing service for the 12th field
 * kind, 'file' (descriptors/types.ts). Deliberately NOT "the expense's own upload service": like
 * `received-invoices/received-invoices.service.ts`, uploading a file is a SEPARATE operation with no
 * document instance to act on yet, but UNLIKE that service, this one is company-scoped only, never
 * document-id-scoped — a 'file' field is generic core vocabulary (see types.ts's own comment on why
 * it is the 12th CORE kind, not a bespoke "expense attachment" concept), so any FUTURE document type
 * that declares one gets upload/download for free, with zero new backend wiring.
 *
 * Storage is REUSED, not duplicated: `persistInboundFile`/`readInboundFile`/`extFor`
 * (`received-invoices/storage.ts`) are the exact same content-hash-addressed,
 * `DOCUMENTS_INBOUND_DIR`-rooted mechanism already proven for supplier deposits — see that module's
 * own header for why the root is re-read on every call (test isolation) and why the path is scoped by
 * `companyId` (tenant isolation on top of the hash). `DOCUMENTS_INBOUND_DIR` already sits under the
 * `documents_data` named volume in docker-compose.yml (the SAME volume `DOCUMENTS_ARCHIVE_DIR` uses) —
 * an attachment therefore already survives a `docker pull` with NO deployment change needed here.
 */
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import { persistInboundFile, readInboundFile } from '../received-invoices/storage';

/**
 * What this app accepts as an attachment TODAY — a receipt is a photo or a PDF. The one consumer
 * that exists (expense.descriptor.ts's `attachment` field) is what fixes this list; a SECOND consumer
 * needing a different allow-list would need this parameterized per field, which nothing here does yet
 * (never invented ahead of an actual second need — same discipline `archive/storage.ts#extFor`'s own
 * small, honest map already holds).
 */
export const ALLOWED_ATTACHMENT_MIMES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * The product ceiling for one attachment (2026-09-17 decision: multipart/form-data replaces the old
 * base64-in-JSON wire format, which was itself capped at ~750 KiB only because it had to fit under
 * `main.ts`'s own global `bodyParser.json({ limit: '1mb' })` after base64's ~4/3 inflation). A real
 * upload no longer travels through that JSON body at all — `documents.controller.ts#uploadAttachment`
 * reads it via multer's `FileInterceptor` straight off the multipart stream, buffered in memory
 * (`memoryStorage()`), with its OWN `limits.fileSize` set to this exact constant — so an oversized
 * file is aborted at the wire, before a single byte of it ever reaches this service. The check below
 * is kept anyway, deliberately: it is what actually runs for any OTHER caller of this method (this
 * file's own spec included) and gives a deterministic, named, byte-counted refusal rather than
 * depending on multer's own generic "File too large" message being wired correctly everywhere.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface AttachmentUploadInput {
  fileName: string;
  mime: string;
  /** Raw file bytes, already read into memory by multer's `memoryStorage()` — never re-encoded
   *  through base64 (see `MAX_ATTACHMENT_BYTES`'s own header for why that convention is gone). */
  bytes: Buffer;
}

export interface AttachmentRef {
  /** The uploaded file's own SHA-256 (hex) — ALSO the content-address key. */
  fileRef: string;
  fileName: string;
  mime: string;
}

@Injectable()
export class AttachmentsService {
  /** Stores the uploaded file content-addressed, scoped to `companyId` — refuses an empty file, a
   *  disallowed mime, or a file over `MAX_ATTACHMENT_BYTES`, each with its own NAMED message (never a
   *  generic "upload failed"). Idempotent for a byte-identical re-upload, exactly like
   *  `received-invoices/storage.ts#persistInboundFile` already is — never refused as a duplicate here
   *  (unlike received-invoices' own upload): an expense receipt legitimately being attached more than
   *  once (e.g. two expense entries split off one paper receipt) is not the "the same supplier
   *  invoice was deposited twice" mistake that check exists to catch. */
  async upload(companyId: string, input: AttachmentUploadInput): Promise<AttachmentRef> {
    if (!ALLOWED_ATTACHMENT_MIMES.includes(input.mime)) {
      throw new BadRequestException(
        `Unsupported file type "${input.mime}" — allowed: ${ALLOWED_ATTACHMENT_MIMES.join(', ')}.`,
      );
    }

    const bytes = input.bytes;
    if (bytes.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        `The uploaded file is ${bytes.length} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit.`,
      );
    }

    const fileRef = computeArtifactHash(bytes);
    await persistInboundFile(companyId, fileRef, input.mime, bytes);

    return { fileRef, fileName: input.fileName, mime: input.mime };
  }

  /** Reads back exactly what `upload` wrote, scoped to `companyId` — a `fileRef` that only exists
   *  under a DIFFERENT company's own directory (or that was never uploaded at all) 404s, named,
   *  exactly the same tenant-isolation-by-construction `received-invoices.service.ts#downloadFile`
   *  already relies on (never a cross-tenant lookup by hash alone). `mime` is required — it is what
   *  `extFor` needs to know which extension this content-addressed path was written under; the
   *  caller always already has it (it is part of the SAME `{ fileRef, fileName, mime }` value the
   *  field itself stores — see field-kinds.ts's own 'file' validator). */
  async download(companyId: string, fileRef: string, mime: string): Promise<{ bytes: Buffer; mime: string }> {
    const bytes = await readInboundFile(companyId, fileRef, mime);
    if (!bytes) {
      throw new NotFoundException(`No attachment (SHA-256 ${fileRef}) found for this company.`);
    }
    return { bytes, mime };
  }
}

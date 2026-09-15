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
 * Derived from — not independent of — `main.ts`'s own global `bodyParser.json({ limit: '1mb' })`:
 * every upload here travels as base64 inside that SAME JSON body (this codebase's one convention for
 * a binary upload — see `received-invoices.service.ts`'s own header on why there is no
 * multipart/`FileInterceptor` anywhere in this backend), so a raw file already larger than roughly
 * 3/4 of 1 MiB (base64 inflates by ~4/3, plus the small JSON envelope around it) is refused BY THE
 * BODY PARSER ITSELF, as a bare, unnamed 413 — before this service, or even this controller, ever
 * runs. This constant sits safely under that real ceiling precisely so this service's own, NAMED
 * refusal is the one a caller actually sees. Raising it for real (a phone photo is routinely several
 * MB) needs `main.ts`'s own body-parser limit raised FIRST — a separate, broader decision (it governs
 * every request body in this app, not only this endpoint), not made here. 750 KiB is the simplest
 * value that fits today's real ceiling; flagged in this feature's own report as a product choice to
 * validate, not a sourced constraint.
 */
export const MAX_ATTACHMENT_BYTES = 750 * 1024;

export interface AttachmentUploadInput {
  fileName: string;
  mime: string;
  /** Base64-encoded raw file bytes — same wire convention every other binary upload in this backend
   *  already uses (received-invoices.service.ts's own `UploadReceivedInvoiceInput.base64`). */
  base64: string;
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

    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        `The uploaded file is ${bytes.length} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit.`,
      );
    }

    const fileRef = computeArtifactHash(bytes);
    persistInboundFile(companyId, fileRef, input.mime, bytes);

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
    const bytes = readInboundFile(companyId, fileRef, mime);
    if (!bytes) {
      throw new NotFoundException(`No attachment (SHA-256 ${fileRef}) found for this company.`);
    }
    return { bytes, mime };
  }
}

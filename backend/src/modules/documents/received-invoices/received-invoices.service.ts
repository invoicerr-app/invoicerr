/**
 * Root TODO item 18 ("réception de factures") — the ONE bespoke service this type needs beyond the
 * generic document machinery: uploading a file is not "persist this type's own declared fields"
 * (`actions/received-invoice-actions.ts`'s "receive" already covers that), it is a SEPARATE
 * operation — store bytes, hash them, refuse an exact repeat, best-effort extract — that has no
 * document instance to act on yet. Controller -> Service -> Prisma, same as everywhere else in this
 * module; Prisma is only ever reached through `persistence.ts`'s existing, tenant-scoped helpers.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import { findOwnedDocument, listDocuments } from '../persistence';
import { extractReceivedInvoiceFields } from './extraction';
import { persistInboundFile, readInboundFile } from './storage';

const TYPE_ID = 'received-invoice';

/** How many of this company's own received invoices are scanned for a hash collision — a bounded,
 *  honest linear check (same `500` cap `persistence.ts#listDocuments`'s own default budget and every
 *  contribution in this module already uses) rather than a JSONB-indexed query: this is a duplicate
 *  UPLOAD check, not a hot read path, and 500 already comfortably covers any real company's inbox. */
const DUPLICATE_CHECK_LIMIT = 500;

export interface UploadReceivedInvoiceInput {
  fileName: string;
  mime: string;
  /** Base64-encoded raw file bytes — same wire convention `signing-certificates.controller.ts`'s own
   *  `pfxBase64` already uses for an uploaded binary in this codebase (no multipart/`FileInterceptor`
   *  anywhere in this backend today — see that controller's own `UploadCertificateBody`). */
  base64: string;
}

export interface UploadReceivedInvoicePreview {
  /** The uploaded file's own SHA-256 (hex) — ALSO the content-address key (`storage.ts`) and the
   *  duplicate-detection key. Not persisted as a `DocumentInstance` by this call: see this file's own
   *  header — the caller (the frontend's upload dialog) seeds this into a NEW record's `data.fileRef`
   *  only once the user actually confirms via the "receive" action. */
  fileRef: string;
  fileName: string;
  mime: string;
  extraction: {
    /** null when nothing recognizable was found — see extraction.ts's own header. Never a refusal:
     *  the file is stored and returned regardless (see `extractionOk` below). */
    syntax: string | null;
    fields: Record<string, unknown>;
  };
}

@Injectable()
export class ReceivedInvoicesService {
  /**
   * Stores the uploaded file content-addressed, refuses an EXACT repeat (same company, same
   * SHA-256, already the `fileRef` of an EXISTING received-invoice record) by name, and returns a
   * best-effort extraction PREVIEW — never a persisted `DocumentInstance`. See
   * received-invoice.descriptor.ts's own header ("Extraction impossible ... jamais un refus") for why
   * a recognized-but-empty extraction is not an error at all, only a genuine duplicate hash is.
   */
  async upload(companyId: string, input: UploadReceivedInvoiceInput): Promise<UploadReceivedInvoicePreview> {
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0) {
      throw new ConflictException('The uploaded file is empty.');
    }
    const fileRef = computeArtifactHash(bytes);

    const existing = await listDocuments(companyId, TYPE_ID, DUPLICATE_CHECK_LIMIT);
    const duplicate = existing.find(
      (doc) => (doc.data as Record<string, unknown> | null)?.fileRef === fileRef,
    );
    if (duplicate) {
      throw new ConflictException(
        `This exact file has already been received (document "${duplicate.id}", ` +
          `SHA-256 ${fileRef}) — re-uploading the same bytes is refused as a duplicate.`,
      );
    }

    persistInboundFile(companyId, fileRef, input.mime, bytes);

    const extraction = await extractReceivedInvoiceFields(bytes, input.mime, input.fileName);

    return {
      fileRef,
      fileName: input.fileName,
      mime: input.mime,
      extraction: { syntax: extraction.syntax, fields: { ...extraction.fields } },
    };
  }

  /** Streams back the ORIGINAL uploaded bytes for an already-saved received-invoice — 404s via
   *  `findOwnedDocument` the same tenant-scoped way every other single-document operation in this
   *  module does, before this ever touches the filesystem. A record whose `data.fileRef` somehow
   *  does not resolve to a file still on disk 404s too, named distinctly — never a raw 500. */
  async downloadFile(
    companyId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; fileName: string; mime: string }> {
    const document = await findOwnedDocument(companyId, TYPE_ID, documentId);
    const data = (document.data ?? {}) as Record<string, unknown>;
    const fileRef = typeof data.fileRef === 'string' ? data.fileRef : undefined;
    const mime = typeof data.fileMime === 'string' ? data.fileMime : 'application/octet-stream';
    const fileName = typeof data.fileName === 'string' ? data.fileName : `${documentId}`;

    if (!fileRef) {
      throw new NotFoundException(`Document "${documentId}" has no original file attached.`);
    }

    const bytes = readInboundFile(companyId, fileRef, mime);
    if (!bytes) {
      throw new NotFoundException(
        `Document "${documentId}" references a file (SHA-256 ${fileRef}) that is no longer on disk.`,
      );
    }

    return { bytes, fileName, mime };
  }
}

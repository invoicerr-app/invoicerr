/**
 * Root TODO item 18 ("réception de factures") — the ONE bespoke service this type needs beyond the
 * generic document machinery: uploading a file is not "persist this type's own declared fields"
 * (`actions/received-invoice-actions.ts`'s "receive" already covers that), it is a SEPARATE
 * operation — store bytes, hash them, refuse an exact repeat, best-effort extract — that has no
 * document instance to act on yet. Controller -> Service -> Prisma, same as everywhere else in this
 * module; `DocumentInstance` reads/writes go through `persistence.ts`'s tenant-scoped helpers, as
 * everywhere else in this module. TODO_PRODUIT.md T5(b) adds ONE further Prisma-touching step —
 * `supplier-reconciliation.ts`'s own `reconcileSupplierClient`, reaching `Client`/`PartyIdentifier`
 * directly (never through `ClientsService` — see that file's own header for why) — because matching a
 * supplier is not a `DocumentInstance` concern `persistence.ts` has any business knowing about.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import { findOwnedDocument, listDocuments } from '../persistence';
import { extractReceivedInvoiceFields } from './extraction';
import { persistInboundFile, readInboundFile } from './storage';
import { reconcileSupplierClient, SupplierMatchResult } from './supplier-reconciliation';

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
  /**
   * TODO_PRODUIT.md T5(b) — the OUTCOME of auto-reconciliation "au dépôt", computed from whatever the
   * `extraction` above just read (`supplierVatId`/`supplier`) — see `supplier-reconciliation.ts`'s own
   * header for the exact rule (VAT first, exact name fallback, ambiguity never silently resolved,
   * NEVER a created client). Surfaced separately from `extraction.fields` so the upload dialog can
   * tell the user apart from a silent pre-fill: `outcome: 'matched'` means `extraction.fields` above
   * ALSO carries a `supplierClient` id (the same generic pre-fill mechanism every other extracted
   * field already uses — `custom/received-invoice-upload-button.tsx`'s own `buildInitialData`);
   * anything else means it does not, and the screen says so.
   */
  supplierMatch: SupplierMatchResult;
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

    // TODO_PRODUIT.md T5(b) — "au dépôt": the ONLY point this runs. `data.supplierClient` (a
    // 'reference' field, see received-invoice.descriptor.ts) is filled in HERE, exactly like every
    // other extracted field, then simply flows through the ordinary create form — "receive" never
    // re-runs this (see that action's own header on why).
    const supplierMatch = await reconcileSupplierClient(companyId, {
      vatId: extraction.fields.supplierVatId,
      supplierName: extraction.fields.supplier,
    });
    const fields: Record<string, unknown> = { ...extraction.fields };
    if (supplierMatch.outcome === 'matched') {
      fields.supplierClient = supplierMatch.clientId;
    }

    return {
      fileRef,
      fileName: input.fileName,
      mime: input.mime,
      extraction: { syntax: extraction.syntax, fields },
      supplierMatch,
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

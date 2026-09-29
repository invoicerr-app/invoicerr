import prisma from '@/prisma/prisma.service';
import { DocumentArchiveKind } from '../../../../prisma/generated/prisma/client';

import { hashDocumentData } from '../archive/document-data-hash';
import { StoredArtifactMeta } from '../archive/persistence';

/**
 * Issue #477, "an e-signature must bind to the exact version the client read".
 *
 * ## What a "version" is
 *
 * The PDF the client was actually sent, as the DELIVERY archive written at send time holds it
 * (`archive/archive-on-send.ts`): its archive id and its `contentHash`. A signature request is bound
 * to exactly one such version when it is created (`SignaturesService.requestSignature`), together
 * with the document's own `data` at that moment, which is what the PDF was rendered from.
 *
 * ## What "changed" means, and why
 *
 * A bound request stops being signable the moment EITHER holds:
 *  1. the document's current `data` no longer hashes to the bound `documentDataHash`, or
 *  2. the document's most recent DELIVERY archive is no longer the bound one (compared by
 *     `contentHash`, the issue's own identifier of a version): the quote was sent again and the
 *     client now holds a newer PDF than the one this link was issued for.
 *
 * Any change to `data`, not only to the lines or the options, because every key of a quote's `data`
 * is printed on the PDF the client reads: the lines and options, but also the dates, the currency,
 * the notes (where payment terms and conditions usually live) and the client reference. A narrower
 * rule, say "only lines and totals", would let an issuer move a due date or rewrite the conditions
 * under a pending signature. A wider one, `DocumentInstance.updatedAt`, would invalidate a request
 * on writes the client never sees (the "sending" to "sent" status write, `lastArchiveError`
 * bookkeeping, a conformity poll), so it is deliberately not used. A save that writes back
 * byte-identical `data` is not a change by this rule; it still moves a quote back to "draft"
 * (`save-draft`), which `markSigned`'s own status guard refuses on its own.
 *
 * Changes outside `data` that a fresh render would pick up (the client's address in the client
 * book, the company's logo) do not invalidate anything, and need not: the client signs the ARCHIVED
 * PDF, which does not move when those do.
 */

/** Machine-readable code carried by every refusal caused by a changed document, so the public page
 *  can show its own explanation instead of a generic error. Hand-mirrored in
 *  `frontend/src/pages/(app)/signature/[token].tsx`, the same convention
 *  `options/quote-options.ts#OPTION_NO_LONGER_VALID_CODE` follows. */
export const DOCUMENT_CHANGED_CODE = 'DOCUMENT_CHANGED_SINCE_REQUEST';

export const DOCUMENT_CHANGED_MESSAGE =
  'This document has changed since this signature link was sent, so it can no longer be signed ' +
  'through this link. Ask the sender for the updated document and a new signature link.';

/** The artifact role a quote's email delivery archives its PDF under (`actions/send-document-email.ts`). */
const DELIVERED_PDF_ROLE = 'pdf';
const DELIVERED_PDF_MIME = 'application/pdf';

/** The hash itself lives in `archive/document-data-hash.ts` since issue #490 reused it for the
 *  DELIVERY archive; re-exported here so every #477 caller keeps its import. */
export { hashDocumentData };

export interface DeliveredVersion {
  archiveId: string;
  contentHash: string;
  uri: string;
  pdfRole: string;
  pdfMime: string;
}

export type DeliveredVersionResolution =
  | { found: true; version: DeliveredVersion }
  | { found: false; reason: string };

/**
 * The version a NEW signature request binds to: the most recent DELIVERY archive of this document,
 * provided it carries the delivered PDF and was written for the CURRENT delivery.
 *
 * "For the current delivery" is `archivedAt >= deliveryConfirmedAt`: `async-send.ts` confirms the
 * delivery first and archives right after, so an archive older than the latest confirmation belongs
 * to an earlier send. That is the case when the latest send's own archiving failed and is waiting
 * for `archive-retry-sweep-runner.ts`; binding to the previous archive then would bind the client to
 * a PDF they were NOT sent last. Refused instead, with the reason, never guessed. A document with no
 * `deliveryConfirmedAt` at all (sent before that column existed) accepts its latest archive as is.
 */
export async function resolveCurrentDeliveredVersion(
  companyId: string,
  document: { id: string; deliveryConfirmedAt?: Date | null },
): Promise<DeliveredVersionResolution> {
  const archive = await prisma.documentArchive.findFirst({
    where: { companyId, documentId: document.id, kind: DocumentArchiveKind.DELIVERY },
    orderBy: { archivedAt: 'desc' },
  });
  if (!archive) {
    return {
      found: false,
      reason:
        'no archived copy of the PDF sent to the client exists for this document, so a signature ' +
        'request cannot be bound to the version they received. Send the document again, then ' +
        'request the signature.',
    };
  }
  if (document.deliveryConfirmedAt && archive.archivedAt.getTime() < document.deliveryConfirmedAt.getTime()) {
    return {
      found: false,
      reason:
        'the PDF of its latest send is not archived yet (archiving is retried automatically). ' +
        'Request the signature again once it is archived.',
    };
  }
  const metas = (archive.artifacts ?? []) as unknown as StoredArtifactMeta[];
  const pdf = metas.find((meta) => meta.role === DELIVERED_PDF_ROLE && meta.mime === DELIVERED_PDF_MIME);
  if (!pdf) {
    return {
      found: false,
      reason: 'its latest delivery archived no PDF, so there is no document the client could sign.',
    };
  }
  return {
    found: true,
    version: {
      archiveId: archive.id,
      contentHash: archive.contentHash,
      uri: archive.uri,
      pdfRole: pdf.role,
      pdfMime: pdf.mime,
    },
  };
}

/** The `contentHash` of this document's most recent DELIVERY archive, or null when it has none. */
export async function latestDeliveryContentHash(
  companyId: string,
  documentId: string,
): Promise<string | null> {
  const archive = await prisma.documentArchive.findFirst({
    where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
    orderBy: { archivedAt: 'desc' },
    select: { contentHash: true },
  });
  return archive?.contentHash ?? null;
}

export interface BoundSignatureVersion {
  deliveryArchiveId: string | null;
  deliveryContentHash: string | null;
  documentDataHash: string | null;
}

/**
 * Whether a signature request can still be signed against the document as it stands now - see this
 * file's own header for the rule. A row created before the binding existed (all three fields null)
 * is never current: nothing proves which version its signer read.
 */
export async function isBoundVersionCurrent(
  row: BoundSignatureVersion & { companyId: string; documentId: string },
  currentData: unknown,
): Promise<boolean> {
  if (!row.deliveryArchiveId || !row.deliveryContentHash || !row.documentDataHash) return false;
  if (hashDocumentData(currentData) !== row.documentDataHash) return false;
  const latest = await latestDeliveryContentHash(row.companyId, row.documentId);
  return latest === row.deliveryContentHash;
}

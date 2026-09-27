import { hashDocumentData } from '../archive/document-data-hash';
import { DocumentTypeDescriptor } from '../descriptors/types';

/**
 * Issue #490: when `documents.service.ts#renderInstancePdf` may serve a document's archived PDF
 * instead of rendering it.
 *
 * The archive in question is the document's most recent DELIVERY archive, the PDF its latest send
 * actually delivered (`archive/persistence.ts#findArchivedPdfArtifact`). Serving it saves a Chromium
 * render, and for an issued document it is also the right answer on its own: it is the legal copy.
 * But an archive stays in place after the document moves on. A quote that was sent, then edited, is
 * back in "draft" with the archive of its earlier send still there, and serving that archive would
 * hand every consumer the PDF of the previous version instead of the draft on screen.
 *
 * ## The rule
 *
 * The archived PDF is served when EITHER holds:
 *  1. the document is ISSUED (see below): the archive is the legal copy, whatever `data` holds now;
 *  2. the archive records the hash of the `data` it was rendered from (`DocumentArchive.
 *     documentDataHash`, written at send time by `actions/async-send.ts`) and the document's current
 *     `data` still hashes to it. The hash is the one an e-signature binds to (issue #477,
 *     `archive/document-data-hash.ts`), so "the version the client was sent" means the same thing
 *     here as on the signing page.
 * Otherwise the document is rendered fresh. An archive written before its hash was recorded (NULL)
 * proves nothing about the data it came from, so an unissued document with such an archive renders:
 * the cost is a render, never a stale PDF.
 *
 * ## What "issued" means, and where the list lives
 *
 * A status is issued for a type when that type's own "save-draft" action LOCKS it
 * (`DocumentActionDescriptor.lockedStatuses`, issue #468): "save-draft" is the only action that
 * rewrites a document's `data`, so a status it locks is one whose content can no longer change. This
 * is the same reading `documents.service.ts#runAction` already gives that list for a "send" retry.
 * Today, from the descriptors themselves:
 *  - invoice (`descriptors/invoice.descriptor.ts`, `SAVE_DRAFT_LOCKED_STATUSES`): every status but
 *    "draft", i.e. "sending", "sent", "send_failed", "cancelled";
 *  - credit note (`descriptors/credit-note.descriptor.ts`, `SAVE_DRAFT_LOCKED_STATUSES`): every status
 *    but "draft", i.e. "sending", "sent", "send_failed";
 *  - quote (`descriptors/quote.descriptor.ts`, `lockedStatuses`): "signed" and "accepted";
 *  - every other type: none, so only the hash rule applies.
 * Derived rather than copied, so a status added to one of those lists is issued here too.
 */

/** The statuses whose archived PDF is the legal copy for this type - see this file's own header. */
export function issuedStatusesOf(descriptor: DocumentTypeDescriptor): readonly string[] {
  return descriptor.actions.find((action) => action.id === 'save-draft')?.lockedStatuses ?? [];
}

/**
 * Whether an archived PDF whose recorded data hash is `archivedDataHash` may be served for a document
 * currently at `status` holding `currentData` - see this file's own header for the rule.
 */
export function isArchivedPdfServable(input: {
  descriptor: DocumentTypeDescriptor;
  status: string;
  currentData: unknown;
  archivedDataHash: string | null;
}): boolean {
  if (issuedStatusesOf(input.descriptor).includes(input.status)) return true;
  if (!input.archivedDataHash) return false;
  return hashDocumentData(input.currentData) === input.archivedDataHash;
}

/**
 * Detects when a legal document's CURRENT content hash (`legal-documents.ts`) is not already on file
 * as a `LegalDocumentRelease` for its slug, and records it — the pure, DB-touching half
 * `legal-release-boot.service.ts`'s `OnModuleInit` calls on EVERY backend boot, self-hosted included:
 * this table is the append-only history of every text this instance has ever shipped, independent of
 * whether anyone gets emailed about it (that's `legal-release-notify.ts`, SaaS-only).
 *
 * A slug with NO prior release row at all is a BOOTSTRAP, not a change: the very first boot that ever
 * runs this (an existing instance upgrading to the version that introduces this table) has nothing to
 * compare the current text against, so recording every already-live document as "a brand new
 * release" the moment this feature ships would be a false "something changed" signal — nothing did,
 * from a user's point of view. The row is still written (so the NEXT real edit has a baseline to be
 * compared against), it is just reported separately from `changed` so the boot log — and, transitively,
 * `legal-release-notify.ts`, which only ever acts on slugs with more than one recorded release — never
 * treats it as notify-worthy.
 *
 * Checked against the exact `(slug, contentHash)` pair (the table's own unique constraint) rather than
 * "does the latest row's hash differ from the current one": reverting a document back to text this
 * instance has already shipped before is not a NEW release, it is the same one — the append-only
 * history should not grow, and nobody should be re-emailed, for a pure revert.
 */
import prisma from '@/prisma/prisma.service';
import { LegalDocument, listLegalDocuments } from './legal-documents';

export interface LegalReleaseDetectionSummary {
  /** Releases just recorded because the slug had NO prior release row at all — logged, never mailed. */
  bootstrapped: LegalDocument[];
  /** Releases just recorded because the current text is new relative to an EXISTING prior release. */
  changed: LegalDocument[];
}

export async function detectAndRecordNewLegalReleases(): Promise<LegalReleaseDetectionSummary> {
  const summary: LegalReleaseDetectionSummary = { bootstrapped: [], changed: [] };

  for (const doc of listLegalDocuments()) {
    const existing = await prisma.legalDocumentRelease.findUnique({
      where: { slug_contentHash: { slug: doc.slug, contentHash: doc.contentHash } },
    });
    if (existing) continue; // this exact text is already on record — the common, steady-state boot.

    const priorReleaseCount = await prisma.legalDocumentRelease.count({ where: { slug: doc.slug } });

    await prisma.legalDocumentRelease.create({
      data: { slug: doc.slug, version: doc.version, contentHash: doc.contentHash },
    });

    if (priorReleaseCount === 0) summary.bootstrapped.push(doc);
    else summary.changed.push(doc);
  }

  return summary;
}

/**
 * The `publishedAt` of the text currently live for `slug` — the exact moment
 * `legal-release-boot.service.ts`'s own `OnModuleInit` first recorded THIS content hash as a
 * `LegalDocumentRelease` row (`schema.prisma`'s own `publishedAt @default(now())`). This is the anchor
 * `modules/billing/paid-period-grace.ts` computes the Terms of Service Section 20.2 calendar floor
 * from — a real, once-stamped release timestamp, deliberately never a document's own author-typed
 * `effectiveDate` front-matter field (`legal-documents.ts`), which an author sets by hand, can leave
 * stale, and which says nothing about when THIS deployment actually started serving the text.
 */
import prisma from '@/prisma/prisma.service';
import { currentContentHashOf } from './legal-documents';

/** `null` when no such row exists yet — unreachable in steady state (`LegalReleaseBootService` records
 *  every document's current hash on every boot, before any request is served), but a defensive
 *  "cannot compute a grace window without an anchor" rather than trusting `new Date()` or throwing. */
export async function currentReleasePublishedAt(slug: string): Promise<Date | null> {
  const contentHash = currentContentHashOf(slug);
  if (!contentHash) return null;

  const release = await prisma.legalDocumentRelease.findUnique({
    where: { slug_contentHash: { slug, contentHash } },
  });
  return release?.publishedAt ?? null;
}

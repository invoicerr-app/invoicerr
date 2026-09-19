/**
 * Records and reads `LegalAcceptance` rows — plain, framework-agnostic functions (import the `prisma`
 * singleton directly, never Nest DI) for the exact reason `billing/seat-sync.ts`/`member-sync.ts` are
 * shaped this way (see those files' own headers): the ONE call site outside Nest entirely is
 * `lib/auth.ts`'s sign-up hook, which has no DI container to inject a service into. `legal.service.ts`
 * (Nest, HTTP) calls these same functions rather than duplicating the upsert/compare logic.
 */
import prisma from '@/prisma/prisma.service';
import { getLegalDocument, REQUIRED_ACCEPTANCE_SLUGS, currentContentHashOf } from './legal-documents';

export interface AcceptanceMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records this user's acceptance of each given slug AT ITS CURRENT content hash (`legal-documents.ts`
 * — see `LegalDocument.contentHash`'s own comment for why acceptance is keyed on the hash, not the
 * author-set `version` string). `version` is still stored alongside it, for display only. Idempotent —
 * upserts on the `(userId, documentSlug, contentHash)` unique constraint, so accepting the same text
 * twice (a double-submit, or the sign-in interstitial re-running after a page refresh) is a no-op,
 * never a constraint error.
 *
 * An unknown slug is silently skipped rather than thrown: a stale frontend build sending a slug this
 * backend no longer recognizes must not turn an otherwise-valid sign-up or re-acceptance into a 500.
 */
export async function recordLegalAcceptance(
  userId: string,
  slugs: readonly string[],
  meta: AcceptanceMeta = {},
): Promise<void> {
  for (const slug of slugs) {
    const doc = getLegalDocument(slug);
    if (!doc) continue;
    await prisma.legalAcceptance.upsert({
      where: {
        userId_documentSlug_contentHash: { userId, documentSlug: slug, contentHash: doc.contentHash },
      },
      create: {
        userId,
        documentSlug: slug,
        version: doc.version,
        contentHash: doc.contentHash,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
      update: {},
    });
  }
}

/**
 * The subset of `REQUIRED_ACCEPTANCE_SLUGS` this user has NOT accepted at its CURRENT content hash —
 * a document text change (even one that keeps the same `version` string — see `LegalAcceptance`'s own
 * schema comment) makes an existing acceptance row stop counting. Drives the sign-in re-acceptance
 * interstitial (`GET /api/legal/status`); callers gate this behind `isBillingEnabled()` first
 * (`legal.service.ts#getStatus`) — nothing ever WRITES a `LegalAcceptance` row on a self-hosted
 * instance, so every slug would otherwise show as permanently pending for a user with no UI to clear
 * it.
 *
 * A row with `contentHash: null` (written before this column existed) never matches — `a.contentHash
 * === currentContentHashOf(...)` is `null === <string>`, always `false` — so a pre-migration
 * acceptance reads back as pending rather than being silently grandfathered in at a hash nobody
 * actually recorded. See `LegalAcceptance`'s own schema comment for why that is the deliberate choice
 * over a backfill.
 */
export async function getPendingAcceptanceSlugs(userId: string): Promise<string[]> {
  const accepted = await prisma.legalAcceptance.findMany({
    where: { userId, documentSlug: { in: [...REQUIRED_ACCEPTANCE_SLUGS] } },
    select: { documentSlug: true, contentHash: true },
  });
  const acceptedAtCurrentHash = new Set(
    accepted.filter((a) => a.contentHash === currentContentHashOf(a.documentSlug)).map((a) => a.documentSlug),
  );
  return REQUIRED_ACCEPTANCE_SLUGS.filter((slug) => !acceptedAtCurrentHash.has(slug));
}

/**
 * Records and reads `LegalAcceptance` rows — plain, framework-agnostic functions (import the `prisma`
 * singleton directly, never Nest DI) for the exact reason `billing/seat-sync.ts`/`member-sync.ts` are
 * shaped this way (see those files' own headers): the ONE call site outside Nest entirely is
 * `lib/auth.ts`'s sign-up hook, which has no DI container to inject a service into. `legal.service.ts`
 * (Nest, HTTP) calls these same functions rather than duplicating the upsert/compare logic.
 */
import prisma from '@/prisma/prisma.service';
import { REQUIRED_ACCEPTANCE_SLUGS, currentVersionOf } from './legal-documents';

export interface AcceptanceMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records this user's acceptance of each given slug AT ITS CURRENT version (`legal-documents.ts`).
 * Idempotent — upserts on the `(userId, documentSlug, version)` unique constraint, so accepting the
 * same version twice (a double-submit, or the sign-in interstitial re-running after a page refresh)
 * is a no-op, never a constraint error.
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
    const version = currentVersionOf(slug);
    if (!version) continue;
    await prisma.legalAcceptance.upsert({
      where: { userId_documentSlug_version: { userId, documentSlug: slug, version } },
      create: {
        userId,
        documentSlug: slug,
        version,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
      update: {},
    });
  }
}

/**
 * The subset of `REQUIRED_ACCEPTANCE_SLUGS` this user has NOT accepted at its CURRENT version — a
 * document text change (a new `version` in its front matter) makes an existing acceptance row stop
 * counting, which is the whole point of keying uniqueness on version rather than slug alone (see
 * `LegalAcceptance`'s own schema comment). Drives the sign-in re-acceptance interstitial
 * (`GET /api/legal/status`); callers gate this behind `isBillingEnabled()` first
 * (`legal.service.ts#getStatus`) — nothing ever WRITES a `LegalAcceptance` row on a self-hosted
 * instance, so every slug would otherwise show as permanently pending for a user with no UI to clear
 * it.
 */
export async function getPendingAcceptanceSlugs(userId: string): Promise<string[]> {
  const accepted = await prisma.legalAcceptance.findMany({
    where: { userId, documentSlug: { in: [...REQUIRED_ACCEPTANCE_SLUGS] } },
    select: { documentSlug: true, version: true },
  });
  const acceptedAtCurrentVersion = new Set(
    accepted.filter((a) => a.version === currentVersionOf(a.documentSlug)).map((a) => a.documentSlug),
  );
  return REQUIRED_ACCEPTANCE_SLUGS.filter((slug) => !acceptedAtCurrentVersion.has(slug));
}

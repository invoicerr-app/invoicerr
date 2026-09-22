import prisma from '@/prisma/prisma.service';

/**
 * Tenant-safe persistence for `DocumentDownloadToken` — the same split `documents/persistence.ts`
 * already holds for the document instance itself (plain functions over the Prisma singleton, never
 * a hand-rolled repository class), used by `ShareLinksService`.
 */

export interface ShareLinkTokenRecord {
  id: string;
  tokenHash: string;
  typeId: string;
  documentId: string;
  companyId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

export async function createShareLinkToken(input: {
  companyId: string;
  typeId: string;
  documentId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<ShareLinkTokenRecord> {
  return prisma.documentDownloadToken.create({
    data: {
      companyId: input.companyId,
      typeId: input.typeId,
      documentId: input.documentId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  });
}

/** Every token ever minted for this document, newest first — METADATA ONLY (this is the shape
 *  `ShareLinksService.list` hands the frontend): the caller never gets `tokenHash` back out of this
 *  module in a way that lets it reconstruct or re-display the raw token — see this directory's own
 *  `share-link-token.ts` header on why the raw value is never persisted in the first place. */
export async function listShareLinkTokens(
  companyId: string,
  documentId: string,
): Promise<ShareLinkTokenRecord[]> {
  return prisma.documentDownloadToken.findMany({
    where: { companyId, documentId },
    orderBy: { createdAt: 'desc' },
  });
}

/** 404s (via the caller — see share-links.service.ts) when `tokenId` doesn't exist or belongs to a
 *  different company/document — same "existence and ownership are indistinguishable from outside"
 *  discipline `documents/persistence.ts`'s own `findOwnedDocument` already holds. */
export async function findOwnedShareLinkToken(
  companyId: string,
  documentId: string,
  tokenId: string,
): Promise<ShareLinkTokenRecord | null> {
  return prisma.documentDownloadToken.findFirst({ where: { id: tokenId, companyId, documentId } });
}

/** Soft-revokes — sets `revokedAt`, never deletes the row. See schema.prisma's own comment on
 *  `DocumentDownloadToken` for why: who shared what, and when it was pulled back, is information
 *  worth keeping even once the link itself is dead. Idempotent: revoking an already-revoked token
 *  again is a no-op on the already-set timestamp, not a second, later one silently overwriting the
 *  first (the caller decides whether that idempotency is surfaced or refused — see
 *  share-links.service.ts). */
export async function revokeShareLinkToken(id: string): Promise<ShareLinkTokenRecord> {
  const existing = await prisma.documentDownloadToken.findUniqueOrThrow({ where: { id } });
  if (existing.revokedAt) return existing;
  return prisma.documentDownloadToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

/**
 * The PUBLIC resolution path — looked up by `tokenHash` (a unique index, so this is an O(1) exact
 * match, never a scan-and-compare that could leak timing information about a partial match — see
 * share-link-token.ts's own header). Returns the raw record regardless of expiry/revocation; it is
 * deliberately `ShareLinksService.resolvePublicToken`'s job, not this function's, to decide those —
 * keeping this one function the SAME single query for "unknown token" as for "known but dead", which
 * is exactly what makes the three cases (unknown / expired / revoked) cost the same, indistinguishable
 * amount of work.
 */
export async function findShareLinkTokenByHash(tokenHash: string): Promise<ShareLinkTokenRecord | null> {
  return prisma.documentDownloadToken.findUnique({ where: { tokenHash } });
}

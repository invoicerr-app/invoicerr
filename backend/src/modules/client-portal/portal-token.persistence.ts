import prisma from '@/prisma/prisma.service';

/**
 * Tenant-safe persistence for `ClientPortalToken` — the same "plain functions over the Prisma
 * singleton" split `share-links/share-link.persistence.ts` already holds for `DocumentDownloadToken`.
 */

export interface PortalTokenRecord {
  id: string;
  tokenHash: string;
  clientId: string;
  companyId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export async function createPortalToken(input: {
  companyId: string;
  clientId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<PortalTokenRecord> {
  return prisma.clientPortalToken.create({
    data: {
      companyId: input.companyId,
      clientId: input.clientId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  });
}

/** Every token ever minted for this client, newest first — METADATA ONLY, same "never re-consultable"
 *  guarantee `share-link.persistence.ts#listShareLinkTokens` already documents: no `tokenHash` field
 *  leaves this module in a form that lets a caller reconstruct or re-display the raw secret. */
export async function listPortalTokens(companyId: string, clientId: string): Promise<PortalTokenRecord[]> {
  return prisma.clientPortalToken.findMany({
    where: { companyId, clientId },
    orderBy: { createdAt: 'desc' },
  });
}

/** 404s (via the caller) when `tokenId` doesn't exist or belongs to a different company/client — same
 *  "existence and ownership are indistinguishable from outside" discipline every other tenant-scoped
 *  lookup in this codebase already holds. */
export async function findOwnedPortalToken(
  companyId: string,
  clientId: string,
  tokenId: string,
): Promise<PortalTokenRecord | null> {
  return prisma.clientPortalToken.findFirst({ where: { id: tokenId, companyId, clientId } });
}

/** Soft-revokes — sets `revokedAt`, never deletes the row. Idempotent, same as
 *  `share-link.persistence.ts#revokeShareLinkToken`: revoking an already-revoked token is a no-op on
 *  the already-set timestamp. */
export async function revokePortalToken(id: string): Promise<PortalTokenRecord> {
  const existing = await prisma.clientPortalToken.findUniqueOrThrow({ where: { id } });
  if (existing.revokedAt) return existing;
  return prisma.clientPortalToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

/**
 * Revokes every currently-active token for a client in one write — used when a company member
 * regenerates the invite (a fresh link should not leave a stale one still able to sign in) and by
 * `deleteClient`'s own cascade concern (a deleted `Client` row cascades this table already; this is
 * for the "client stays, access is pulled" case a hard delete does not cover).
 */
export async function revokeAllPortalTokens(companyId: string, clientId: string): Promise<void> {
  await prisma.clientPortalToken.updateMany({
    where: { companyId, clientId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * The PUBLIC resolution path — looked up by `tokenHash` (a unique index, an O(1) exact match — see
 * portal-token.ts's own header on why this closes off any timing side-channel). Returns the raw
 * record regardless of expiry/revocation; deciding those is `PortalAuthGuard`'s job, not this
 * function's — the same split `share-link.persistence.ts#findShareLinkTokenByHash` already holds.
 */
export async function findPortalTokenByHash(tokenHash: string): Promise<PortalTokenRecord | null> {
  return prisma.clientPortalToken.findUnique({ where: { tokenHash } });
}

/** Fire-and-forget — a portal session touching its own `lastUsedAt` must never fail, or slow down,
 *  the request it is riding along with. Mirrors `AuthGuard`'s own identical treatment of an API key's
 *  `lastUsedAt`. */
export function touchPortalTokenLastUsed(id: string): void {
  prisma.clientPortalToken.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
}

/**
 * The portal token's own crypto — the SAME shape as `share-links/share-link-token.ts` (see that
 * file's own header for the full rationale, repeated only in brief here): 256 random bits, a plain
 * SHA-256 digest is exactly the right (and only) thing stored, and there is no timing side-channel to
 * close because `findPortalTokenByHash` (`portal-token.persistence.ts`) only ever resolves it through
 * an exact unique-index lookup, never a manual byte-for-byte comparison in application code.
 */
import { createHash, randomBytes } from 'node:crypto';

/** 256 bits — the same entropy budget every other bearer token in this codebase uses
 *  (share-link-token.ts, signature-token.ts), never reduced. */
const TOKEN_BYTES = 32;

export interface GeneratedPortalToken {
  /** The raw, high-entropy secret — handed to the caller EXACTLY ONCE (the create response, and the
   *  invite email) and never persisted anywhere. A lost token is a new one to mint, never a "look it
   *  up again" support request the model has to satisfy. */
  token: string;
  /** What actually gets written to `ClientPortalToken.tokenHash`. */
  tokenHash: string;
}

export function generatePortalToken(): GeneratedPortalToken {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashPortalToken(token) };
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

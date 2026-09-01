/**
 * The token's own crypto — deliberately the SMALLEST possible surface, split out from
 * share-links.service.ts so the one function that touches `crypto` at all is easy to audit on its
 * own. Same discipline as `@/utils/api-key.ts`'s `hashApiKey`, and the repère's own
 * pdf-links.service.ts (git tag `avant-refonte-documents`) before it: no hand-rolled crypto, node's
 * native `crypto` module only.
 *
 * `tokenHash` is NOT a password hash and doesn't need to be one: unlike a password, a token this
 * high-entropy (256 random bits) is never guessed by brute force fast enough to matter, and
 * `resolveShareLinkByHash` (share-link.persistence.ts) only ever looks it up by EXACT match through
 * a unique DB index — never by a manual byte-for-byte comparison in application code — so there is
 * no timing side-channel to close with a constant-time compare either (the repère's own service
 * carried the identical reasoning in its header, and never added one). A fast digest (SHA-256) is
 * exactly right here: it is not protecting against an attacker who already has the hash and wants to
 * invert it (there is nothing to invert — the entropy lives in the random token, not the hash), only
 * turning an unbounded-length secret into a fixed-size, indexable lookup key.
 */
import { createHash, randomBytes } from 'node:crypto';

/** 256 bits — the same entropy budget the repère's own `PdfLinksService` used
 *  (`randomBytes(32).toString('hex')`), never reduced. */
const TOKEN_BYTES = 32;

export interface GeneratedShareLinkToken {
  /** The raw, high-entropy secret — handed to the caller EXACTLY ONCE (the create response) and
   *  never persisted anywhere. Losing it is by design: a lost link is a new one to generate, never a
   *  "look it up again" support request the model has to satisfy. */
  token: string;
  /** What actually gets written to `DocumentDownloadToken.tokenHash` — see this file's own header
   *  for why a plain SHA-256 digest is the right (and only) thing stored. */
  tokenHash: string;
}

export function generateShareLinkToken(): GeneratedShareLinkToken {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashShareLinkToken(token) };
}

export function hashShareLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

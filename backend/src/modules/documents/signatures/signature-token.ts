/**
 * The signature LINK's own crypto — the exact `share-links/share-link-token.ts` pattern (see that
 * file's own header for the full reasoning: 256 bits of entropy is never brute-forced fast enough to
 * matter, so a plain SHA-256 digest, looked up by an exact unique-index match, is exactly right — no
 * hand-rolled crypto, node's native `crypto` module only, and no timing-safe compare needed here
 * either, unlike the OTP itself — see `otp.ts`).
 *
 * A SEPARATE file from `share-link-token.ts`, not a shared import: two independent, equally-small
 * modules that both happen to do the same 3-line thing are easier to audit each on their own than one
 * shared helper two unrelated features would otherwise both depend on — the removed module's own
 * fatal mistake was conflating "the signature's id" with "the link's secret"; keeping this token's
 * own crypto in a file scoped to `signatures/` keeps that boundary visible.
 *
 * `id` (the `Signature` row's own primary key) is NEVER the link's secret — see schema.prisma's own
 * `Signature` header, "the actual break" GHSA-vhjw-gwc5-pjfp names. The link emailed to a client is
 * built from the RAW token this module hands back exactly once (`${APP_URL}/signature/${token}`,
 * `signatures.service.ts`'s own `requestSignature`) — the database only ever stores `tokenHash`.
 */
import { createHash, randomBytes } from 'node:crypto';

/** 256 bits — the same entropy budget `share-link-token.ts`'s own `TOKEN_BYTES` uses, never reduced. */
const TOKEN_BYTES = 32;

export interface GeneratedSignatureToken {
  /** The raw, high-entropy secret — handed to the caller EXACTLY ONCE (when a signature request is
   *  created) and never persisted anywhere. */
  token: string;
  /** What actually gets written to `Signature.tokenHash`. */
  tokenHash: string;
}

export function generateSignatureToken(): GeneratedSignatureToken {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashSignatureToken(token) };
}

export function hashSignatureToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

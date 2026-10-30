/**
 * Invitation codes are bearer credentials: whoever presents a live one joins the company it was
 * issued for. Storing the code itself therefore means a database dump — or a leaked read replica —
 * hands the attacker a set of working join links until each one is used or expires.
 *
 * Only a keyed digest is stored. Presentation hashes the presented value with the same key and looks
 * the row up by that digest, so the plaintext never needs to exist at rest anywhere:
 *  - `InvitationCode.codeHash` (unique) — the digest, the only searchable form;
 *  - `InvitationCode.codePrefix` — the first eight characters, kept for the settings screen, which
 *    already only ever displayed a truncated preview;
 *  - Redis `pending-signup:invitation-code:*` — the same digest, not the code (see
 *    `pending-signup-store.ts`), so a Redis dump is no more replayable than a Postgres one.
 *
 * ## Algorithm and key
 * HMAC-SHA256, hex-encoded. HMAC rather than a bare SHA-256 so the digest is useless without a key
 * this process holds: an attacker who steals a dump cannot even confirm a guessed code offline
 * against the table without also stealing the key. The key is derived from the deployment's existing
 * auth secret (`BETTER_AUTH_SECRET`, falling back to `JWT_SECRET`, exactly like `lib/auth.ts`) through
 * a fixed label, which gives domain separation without adding a new required environment variable:
 * rotating the auth secret already invalidates every session, and it invalidates pending invitations
 * with it. The label is versioned so a future key change can be introduced alongside the old one.
 *
 * ## No per-row salt, on purpose
 * A salt would be stored next to the digest and would have to be known before the lookup, which is
 * impossible when the only thing the caller has is the code. The codes themselves are 128 bits from
 * `randomBytes(16)` (see `invitations.service.ts#generateCode`), so a stolen table cannot be brute
 * forced even with a salt; the key is what removes the offline-guess shortcut.
 *
 * ## Constant-time comparison
 * The lookup is an equality query on the unique `codeHash` column. `invitationCodesMatch` performs
 * the same comparison again in constant time after the row is read — cheap, and it closes the door on
 * a future caller comparing digests with `===` (which leaks a prefix through timing).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Domain separation label — change the suffix, not the prefix, if the scheme is ever versioned. */
const HASH_KEY_LABEL = 'invoicerr/invitation-code/v1';

/** The eight-leading-character preview the settings screen shows, and nothing more. */
export const INVITATION_CODE_PREFIX_LENGTH = 8;

function hashingKey(): Buffer {
  const masterSecret = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || '';
  return createHmac('sha256', masterSecret).update(HASH_KEY_LABEL).digest();
}

/** Digest of a presented code. Deterministic for a given deployment secret. */
export function hashInvitationCode(code: string): string {
  return createHmac('sha256', hashingKey()).update(code).digest('hex');
}

/** Non-secret display prefix stored beside the digest. */
export function invitationCodePrefix(code: string): string {
  return code.slice(0, INVITATION_CODE_PREFIX_LENGTH);
}

/**
 * Constant-time check that a presented code produced the stored digest. The Prisma lookup already
 * guarantees this for the paths that use it; this is the explicit, timing-safe primitive for any
 * future caller that has a row in hand.
 */
export function invitationCodesMatch(presentedCode: string, storedHash: string): boolean {
  const expected = Buffer.from(hashInvitationCode(presentedCode), 'utf8');
  const actual = Buffer.from(storedHash, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

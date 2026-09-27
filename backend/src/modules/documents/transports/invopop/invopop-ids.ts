/**
 * The two UUIDs the Invopop transport writes with, derived DETERMINISTICALLY from the document.
 *
 * WHY THEY ARE NOT RANDOM. `transports/invopop-transport.ts` deposits by `PUT`ting a silo entry and
 * then a job, each under an id the caller chooses. The platform answers `409 Conflict` to a repeat of
 * either (see `invopop-client.ts`'s own header, point 4), and the client turns that into "already
 * created, re-read it". That safety net only works if a RETRY computes the SAME id: `send()` runs
 * inside a BullMQ job that retries on any thrown error (`actions/async-send.ts`), so a random UUID
 * would make every retry a SECOND deposit of the same invoice - on a platform whose workflow may
 * already have handed the first one to a tax authority or a Peppol access point. A duplicate invoice
 * at a tax authority is not a bug you fix by re-running something.
 *
 * WHY VERSION 7 AND NOT VERSION 5. A name-based UUIDv5 would be the obvious way to make an id
 * reproducible, but Invopop enforces the UUID VERSION per silo folder: time-based (v1/v7) for
 * documents with a lifespan such as invoices, name-based (v3/v4/v5) for long-lived data such as
 * parties and items. So the id below is a genuine v7 - a 48-bit millisecond timestamp, the version
 * and variant bits, and 74 bits of entropy - except that the timestamp is the document's OWN
 * creation instant and the entropy is a SHA-256 of a stable string instead of `randomBytes`. Same
 * layout, same version nibble, reproducible.
 *
 * The purpose suffix keeps the entry's id and the job's id distinct while both stay derived from the
 * one document: two different records must never collide on one id.
 */
import { createHash } from 'node:crypto';

/** What this id is FOR - the suffix that keeps the entry and the job from colliding. */
export type InvopopIdPurpose = 'entry' | 'job';

/**
 * A UUIDv7-shaped, reproducible id for one (document, purpose) pair.
 *
 * `timestampMs` is the document's own `createdAt`, not `Date.now()` - the whole point is that two
 * calls separated in time produce the same value. A caller that has no timestamp to offer would be
 * defeating the idempotency this module exists for, so the parameter is required.
 */
export function invopopDeterministicId(
  documentId: string,
  purpose: InvopopIdPurpose,
  timestampMs: number,
): string {
  // 48-bit millisecond timestamp, exactly as UUIDv7 lays it out. Clamped rather than wrapped: a
  // timestamp outside the representable range is a broken clock, and silently wrapping it would
  // produce a valid-looking id for the wrong instant.
  const ms = Math.max(0, Math.min(Math.floor(timestampMs), 0xffffffffffff));

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(ms, 0, 6);

  // The remaining 10 bytes come from a hash of the stable inputs rather than from randomness, which
  // is what makes a retry reproduce the id. The hash is not a secret and carries no entropy claim:
  // it only has to be stable and collision-resistant across this workspace's own documents.
  const digest = createHash('sha256').update(`${documentId}:${purpose}`).digest();
  digest.copy(bytes, 6, 0, 10);

  // Version 7 in the high nibble of byte 6, and the RFC 4122 variant (0b10) in the top bits of
  // byte 8 - without both, the platform rejects the id as the wrong UUID version for this folder.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join(
    '-',
  );
}

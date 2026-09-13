/**
 * Picks up the reasoning of `avant-refonte-documents:backend/src/compliance/providers/archive/
 * storage.ts` (`computeContentHash`) — a real SHA-256 over each artifact, in array order. Each
 * artifact is FRAMED by a stable header (`role|mime|byteLength\n`) before its raw bytes, so that the
 * hash:
 *   - covers EVERY archived artifact, not just the first;
 *   - is unambiguous about where one artifact's bytes end and the next one's begin — a BARE
 *     concatenation would let two DIFFERENT artifact sets collide (or shift into one another) in the
 *     same hash; the length-prefixed header rules that out;
 *   - changes if an artifact's bytes are modified, or if an artifact is added / removed / reordered.
 * Deterministic for identical input. Returns lowercase hexadecimal (64 characters for SHA-256).
 *
 * Deliberately adapted from the removed compliance engine: NO separate `syntax` field in the header.
 * The removed compliance engine framed `role|syntax|mime|byteLength` because its own `SignedArtifact`
 * carried both axes independently (a single `role` could come in several `syntax` variants). This
 * module has no such distinct axis: `role` already IS the delivered format ('pdf', 'facturx', 'fa3',
 * 'fatturapa' — see `transports/*-transport.ts`), never a generic role shared by two different
 * syntaxes. Dropping a field that would carry no distinct information here does not weaken the
 * framing: every dimension that actually distinguishes two artifacts (role, MIME type, length) stays
 * in the header, and the anti-collision property that matters — two different artifact sets can never
 * produce the same framed byte sequence — still holds.
 */
import { createHash } from 'node:crypto';

/** An artifact ACTUALLY delivered, ready to be hashed/archived — never an artifact a transport could
 *  have produced but did not send. */
export interface ArchivedArtifactInput {
  /** What this artifact IS — 'pdf' (the human-readable PDF, signed if it was) or the id of the
   *  structured format actually deposited/submitted ('facturx' | 'fa3' | 'fatturapa' — see
   *  `formats/format-provider.ts#DocumentFormatProvider.id`). Never a generic role shared by two
   *  different formats (see this file's own header). */
  role: string;
  mime: string;
  bytes: Uint8Array;
}

/** The PLAIN (unframed) hash of A SINGLE artifact — what `verify` names "expected" for THIS specific
 *  artifact when it reports CORRUPTED. Distinct from `computeContentHash` (which hashes the FRAMED,
 *  ordered WHOLE set): this one is used to know WHICH of an archive's artifacts was tampered with. */
export function computeArtifactHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** See this file's own header. */
export function computeContentHash(artifacts: ArchivedArtifactInput[]): string {
  const hash = createHash('sha256');
  for (const artifact of artifacts) {
    hash.update(`${artifact.role}|${artifact.mime}|${artifact.bytes.length}\n`, 'utf8');
    hash.update(artifact.bytes);
  }
  return hash.digest('hex');
}

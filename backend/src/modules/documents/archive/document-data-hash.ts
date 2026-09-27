import { createHash } from 'node:crypto';

/**
 * The ONE hash of a document's `data` this module computes. Introduced by issue #477 for the
 * e-signature binding (`signatures/signed-version.ts`, which re-exports it) and reused by issue #490
 * for the DELIVERY archive's own `documentDataHash` (`archive/archive-on-send.ts`), so "the data a
 * signature was bound to" and "the data an archived PDF was rendered from" are always comparable with
 * each other: same serialization, same digest.
 */

/** Key-sorted, recursive serialization: Postgres `jsonb` does not preserve key order, so hashing a
 *  plain `JSON.stringify` of what was read back would report a change where there is none. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 (hex) over the canonical serialization of a document's `data`. */
export function hashDocumentData(data: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(data ?? {}))
    .digest('hex');
}

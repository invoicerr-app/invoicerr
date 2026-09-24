/**
 * The idempotency ids. Small file, but the property it pins is the one that stops a retried send from
 * depositing the same invoice twice - see `invopop-ids.ts`'s own header.
 */
import { invopopDeterministicId } from './invopop-ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREATED_AT = Date.parse('2026-09-24T08:19:48.306Z');

describe('invopopDeterministicId', () => {
  it('is stable across calls - the whole point, since a BullMQ retry recomputes it', () => {
    expect(invopopDeterministicId('doc-1', 'entry', CREATED_AT)).toBe(
      invopopDeterministicId('doc-1', 'entry', CREATED_AT),
    );
  });

  it('is a well-formed UUID version 7 - the platform enforces the version per silo folder', () => {
    expect(invopopDeterministicId('doc-1', 'entry', CREATED_AT)).toMatch(UUID_V7);
    expect(invopopDeterministicId('doc-1', 'job', CREATED_AT)).toMatch(UUID_V7);
  });

  it('carries the document timestamp in the 48 bits a v7 reserves for it', () => {
    const id = invopopDeterministicId('doc-1', 'entry', CREATED_AT);
    const timestampHex = id.slice(0, 8) + id.slice(9, 13);
    expect(Number.parseInt(timestampHex, 16)).toBe(CREATED_AT);
  });

  it('gives the entry and the job different ids - two records must never collide on one id', () => {
    expect(invopopDeterministicId('doc-1', 'entry', CREATED_AT)).not.toBe(
      invopopDeterministicId('doc-1', 'job', CREATED_AT),
    );
  });

  it('gives two documents different ids', () => {
    expect(invopopDeterministicId('doc-1', 'entry', CREATED_AT)).not.toBe(
      invopopDeterministicId('doc-2', 'entry', CREATED_AT),
    );
  });

  it('clamps a broken clock rather than wrapping it into a valid-looking id for the wrong instant', () => {
    expect(invopopDeterministicId('doc-1', 'entry', -1)).toMatch(UUID_V7);
    expect(invopopDeterministicId('doc-1', 'entry', Number.MAX_SAFE_INTEGER)).toMatch(UUID_V7);
  });
});

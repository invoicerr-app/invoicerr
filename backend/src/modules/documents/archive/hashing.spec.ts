import { computeArtifactHash, computeContentHash } from './hashing';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('computeContentHash — the framed hash', () => {
  it('is deterministic for identical input', () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: bytesOf('hello') }];
    expect(computeContentHash(artifacts)).toBe(computeContentHash(artifacts));
  });

  it('returns 64 lowercase hex characters (SHA-256)', () => {
    const hash = computeContentHash([{ role: 'pdf', mime: 'application/pdf', bytes: bytesOf('x') }]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a single byte of one artifact is mutated', () => {
    const original = computeContentHash([
      { role: 'pdf', mime: 'application/pdf', bytes: bytesOf('invoice-0001') },
    ]);
    const mutated = computeContentHash([
      { role: 'pdf', mime: 'application/pdf', bytes: bytesOf('invoice-0002') },
    ]);
    expect(mutated).not.toBe(original);
  });

  it('changes when two artifacts are reordered', () => {
    const pdf = { role: 'pdf', mime: 'application/pdf', bytes: bytesOf('PDF-BYTES') };
    const facturx = { role: 'facturx', mime: 'application/pdf', bytes: bytesOf('FACTURX-BYTES') };
    expect(computeContentHash([pdf, facturx])).not.toBe(computeContentHash([facturx, pdf]));
  });

  it('changes when an artifact is added to, or removed from, the set', () => {
    const pdf = { role: 'pdf', mime: 'application/pdf', bytes: bytesOf('PDF-BYTES') };
    const facturx = { role: 'facturx', mime: 'application/pdf', bytes: bytesOf('FACTURX-BYTES') };
    expect(computeContentHash([pdf])).not.toBe(computeContentHash([pdf, facturx]));
  });

  /**
   * THE REMOVED COMPLIANCE ENGINE'S OWN ANTI-COLLISION TEST (see hashing.ts's own header) — the
   * reason the `role|mime|byteLength\n` header exists at all. Two DIFFERENT artifact sets ("ab"+"c"
   * vs "a"+"bc") whose BARE concatenation of raw bytes would be STRICTLY IDENTICAL ("abc" in both
   * cases) — without framing, they would hash IDENTICALLY despite being genuinely different artifacts
   * (a shifted boundary between two files). This test proves that is NOT the case here: framing by
   * length (and role) makes the two sets distinguishable.
   */
  it('never collides for two different artifact sets whose bytes alone would concatenate identically', () => {
    const setA = [
      { role: 'x', mime: 'application/octet-stream', bytes: bytesOf('ab') },
      { role: 'y', mime: 'application/octet-stream', bytes: bytesOf('c') },
    ];
    const setB = [
      { role: 'x', mime: 'application/octet-stream', bytes: bytesOf('a') },
      { role: 'y', mime: 'application/octet-stream', bytes: bytesOf('bc') },
    ];

    // Proof, within the test itself, that the bare concatenation really would be identical — so this
    // is not an artificial scenario: it is EXACTLY what a concatenation with no header would produce
    // for these two sets.
    const naiveConcatA = Buffer.concat(setA.map((a) => Buffer.from(a.bytes))).toString('hex');
    const naiveConcatB = Buffer.concat(setB.map((a) => Buffer.from(a.bytes))).toString('hex');
    expect(naiveConcatA).toBe(naiveConcatB);

    // The module's REAL (framed) hash distinguishes them — this is the property this test protects,
    // and the one a mutation that made "the hash lose its framing" would break.
    expect(computeContentHash(setA)).not.toBe(computeContentHash(setB));
  });
});

describe('computeArtifactHash — the plain, unframed per-artifact hash', () => {
  it('is the ordinary SHA-256 of the artifact bytes alone', () => {
    const bytes = bytesOf('some pdf bytes');
    expect(computeArtifactHash(bytes)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeArtifactHash(bytes)).toBe(computeArtifactHash(bytesOf('some pdf bytes')));
  });

  it('changes when a single byte changes', () => {
    expect(computeArtifactHash(bytesOf('AAAA'))).not.toBe(computeArtifactHash(bytesOf('AAAB')));
  });
});

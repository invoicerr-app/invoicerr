import { computeArtifactHash, computeContentHash } from './hashing';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('computeContentHash — the framed, encadré hash', () => {
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
   * LE TEST ANTI-COLLISION DU REPÈRE (voir hashing.ts's own header) — la raison d'être de l'en-tête
   * `role|mime|byteLength\n`. Deux jeux d'artefacts DIFFÉRENTS ("ab"+"c" vs "a"+"bc") dont la
   * concaténation NUE des octets bruts serait STRICTEMENT IDENTIQUE ("abc" dans les deux cas) — sans
   * encadrement, ils hacheraient IDENTIQUEMENT malgré des artefacts réellement différents (une frontière
   * décalée entre deux fichiers). Ce test prouve que ce n'est PAS le cas ici : l'encadrement par la
   * longueur (et le rôle) rend les deux jeux distinguables.
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

    // Preuve, dans le test lui-même, que la concaténation NUE serait bien identique — donc que ce
    // n'est pas un cas de figure artificiel : c'est EXACTEMENT ce qu'une concaténation sans en-tête
    // produirait pour ces deux jeux.
    const naiveConcatA = Buffer.concat(setA.map((a) => Buffer.from(a.bytes))).toString('hex');
    const naiveConcatB = Buffer.concat(setB.map((a) => Buffer.from(a.bytes))).toString('hex');
    expect(naiveConcatA).toBe(naiveConcatB);

    // Le hachage RÉEL (encadré) de ce module les distingue — c'est la propriété que ce test protège,
    // et celle que mordrait la mutation "le hachage perd son encadrement".
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

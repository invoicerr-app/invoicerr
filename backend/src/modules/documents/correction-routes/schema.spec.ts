import {
  assertValidCorrectionRouteFact,
  CorrectionRouteFact,
  CORRECTION_ROUTE_IDS,
  InvalidCorrectionRouteProvenanceError,
} from './schema';

function baseFact(overrides: Partial<CorrectionRouteFact> = {}): CorrectionRouteFact {
  return {
    routeId: 'CREDIT_NOTE',
    status: 'allowed',
    provenance: { kind: 'legal', sourceText: 'Some Act, art. 1.', sourceCheckedAt: '2026-09-01' },
    ...overrides,
  };
}

describe('assertValidCorrectionRouteFact', () => {
  it('accepts a well-formed LEGAL fact for each of "required"/"allowed"/"forbidden"', () => {
    for (const status of ['required', 'allowed', 'forbidden'] as const) {
      expect(() => assertValidCorrectionRouteFact(baseFact({ status }), 'test')).not.toThrow();
    }
  });

  it('accepts a well-formed UNVERIFIED fact', () => {
    const fact = baseFact({
      status: 'unverified',
      provenance: { kind: 'unverified', resolutionNote: 'Not researched for this country yet.' },
    });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).not.toThrow();
  });

  it('rejects a routeId outside the eleven canonical routes — the closed-vocabulary gate', () => {
    const fact = baseFact({ routeId: 'BUYER_CORRECTION_NOTE' as never });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/not one of the eleven canonical/);
  });

  it('accepts every one of the eleven canonical route ids', () => {
    for (const routeId of CORRECTION_ROUTE_IDS) {
      expect(() => assertValidCorrectionRouteFact(baseFact({ routeId }), 'test')).not.toThrow();
    }
  });

  it('rejects an unknown status', () => {
    const fact = baseFact({ status: 'maybe' as never });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/is not one of/);
  });

  it('rejects a provenance with an unknown "kind"', () => {
    const fact = baseFact({ provenance: { kind: 'made-up' } as never });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(InvalidCorrectionRouteProvenanceError);
  });

  // THE GATE this whole module exists to enforce — TODO_CORRECTION.md C1's own wording: "une voie au
  // statut required/allowed/forbidden SANS provenance légale -> le chargement ÉCHOUE". One test per
  // status, each a candidate mutation (flip the coupling check and one of these three starts passing).
  it.each([
    'required',
    'allowed',
    'forbidden',
  ] as const)('rejects status "%s" paired with UNVERIFIED provenance — required/allowed/forbidden may never hide behind no citation', (status) => {
    const fact = baseFact({
      status,
      provenance: { kind: 'unverified', resolutionNote: 'Not researched yet.' },
    });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/legal citation/);
  });

  it('rejects status "unverified" paired with LEGAL provenance — the inverse mutation', () => {
    const fact = baseFact({
      status: 'unverified',
      provenance: { kind: 'legal', sourceText: 'Some Act, art. 1.', sourceCheckedAt: '2026-09-01' },
    });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/smuggle in a legal citation/);
  });

  it('rejects a fact claiming "legal" provenance without sourceText/sourceCheckedAt', () => {
    const fact = baseFact({ provenance: { kind: 'legal', sourceText: '', sourceCheckedAt: '' } });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/sourceText/);
  });

  it('rejects a fact claiming "legal" provenance with sourceText but no sourceCheckedAt', () => {
    const fact = baseFact({
      provenance: { kind: 'legal', sourceText: 'Some Act, art. 1.', sourceCheckedAt: '' },
    });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/sourceCheckedAt/);
  });

  it('rejects an "unverified" fact with no resolutionNote', () => {
    const fact = baseFact({ status: 'unverified', provenance: { kind: 'unverified', resolutionNote: '' } });
    expect(() => assertValidCorrectionRouteFact(fact, 'test')).toThrow(/resolutionNote/);
  });
});

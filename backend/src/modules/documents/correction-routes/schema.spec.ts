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

  // THE GATE this whole module exists to enforce — in its original wording: "a route with status
  // required/allowed/forbidden WITHOUT legal provenance -> loading FAILS". One test per status, each
  // a candidate mutation (flip the coupling check and one of these three starts passing).
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

describe('assertValidCorrectionRouteFact: local availability on CANCEL_AND_REPLACE', () => {
  const cancelFact = (overrides: Partial<CorrectionRouteFact>) =>
    baseFact({ routeId: 'CANCEL_AND_REPLACE', ...overrides });
  const unverifiedProvenance = { kind: 'unverified', resolutionNote: 'Not researched.' } as const;

  it.each<[string, Partial<CorrectionRouteFact>]>([
    ['no flag at all', {}],
    ['implementable, unrestricted', { locallyImplementable: true }],
    ['implementable on a required route', { status: 'required', locallyImplementable: true }],
    ['implementable, narrowed', { locallyImplementable: true, restrictedToStatuses: ['send_failed'] }],
    ['explicitly not implementable', { locallyImplementable: false }],
    ['not implementable on a forbidden route', { status: 'forbidden', locallyImplementable: false }],
  ])('accepts %s', (_label, overrides) => {
    expect(() => assertValidCorrectionRouteFact(cancelFact(overrides), 'test')).not.toThrow();
  });

  it.each<[string, Partial<CorrectionRouteFact>, RegExp]>([
    ['the flag on another route', { routeId: 'CREDIT_NOTE', locallyImplementable: true }, /only read on/],
    [
      'a narrowing on another route',
      { routeId: 'CREDIT_NOTE', restrictedToStatuses: ['sent'] },
      /only read on/,
    ],
    ['a non-boolean flag', { locallyImplementable: 'yes' as never }, /must be a boolean/],
    ['an implementable forbidden route', { status: 'forbidden', locallyImplementable: true }, /cannot be/],
    [
      'an implementable unverified route',
      { status: 'unverified', provenance: unverifiedProvenance, locallyImplementable: true },
      /cannot be/,
    ],
    ['a narrowing without the flag', { restrictedToStatuses: ['send_failed'] }, /requires/],
    [
      'a narrowing on a non-implementable route',
      { locallyImplementable: false, restrictedToStatuses: ['send_failed'] },
      /requires/,
    ],
    ['an empty narrowing', { locallyImplementable: true, restrictedToStatuses: [] }, /non-empty array/],
    ['a blank status name', { locallyImplementable: true, restrictedToStatuses: [' '] }, /non-empty array/],
    [
      'a non-array narrowing',
      { locallyImplementable: true, restrictedToStatuses: 'sent' as never },
      /non-empty array/,
    ],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => assertValidCorrectionRouteFact(cancelFact(overrides), 'test')).toThrow(message);
  });
});

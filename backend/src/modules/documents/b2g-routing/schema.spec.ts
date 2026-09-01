import { assertValidB2gRoutingFact, B2gRoutingRuleFact, InvalidB2gRoutingProvenanceError } from './schema';

function baseFact(overrides: Partial<B2gRoutingRuleFact> = {}): B2gRoutingRuleFact {
  return {
    countryCode: 'XX',
    transportId: 'some-transport',
    formatSyntax: 'some-format',
    provenance: { kind: 'legal', sourceText: 'Some Act, art. 1.', sourceCheckedAt: '2026-09-01' },
    ...overrides,
  };
}

describe('assertValidB2gRoutingFact', () => {
  it('accepts a well-formed LEGAL fact', () => {
    expect(() => assertValidB2gRoutingFact(baseFact(), 'test')).not.toThrow();
  });

  it('accepts a well-formed UNVERIFIED fact — every row is already a mandate, unverified provenance is still LOADABLE', () => {
    const fact = baseFact({
      provenance: { kind: 'unverified', resolutionNote: 'Read the primary text once reachable.' },
    });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).not.toThrow();
  });

  it('rejects a fact with no countryCode', () => {
    const fact = baseFact({ countryCode: '' });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(InvalidB2gRoutingProvenanceError);
  });

  it('rejects a fact with no transportId', () => {
    const fact = baseFact({ transportId: '' });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/transportId/);
  });

  it('rejects a fact with no formatSyntax', () => {
    const fact = baseFact({ formatSyntax: '' });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/formatSyntax/);
  });

  it('rejects a fact claiming "legal" provenance without sourceText/sourceCheckedAt — the exact case the task calls out', () => {
    const fact = baseFact({ provenance: { kind: 'legal', sourceText: '', sourceCheckedAt: '' } });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(InvalidB2gRoutingProvenanceError);
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/legal.*provenance|sourceText/i);
  });

  it('rejects a fact claiming "unverified" without a resolutionNote', () => {
    const fact = baseFact({ provenance: { kind: 'unverified', resolutionNote: '' } });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/resolutionNote/);
  });

  it('rejects a provenance with an unknown "kind"', () => {
    const fact = baseFact({ provenance: { kind: 'made-up' } as never });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(InvalidB2gRoutingProvenanceError);
  });

  it('rejects a requiredClientIdentifiers entry missing scheme/label/why', () => {
    const fact = baseFact({
      requiredClientIdentifiers: [{ scheme: '', label: 'SIRET', why: 'because' }],
    });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/requiredClientIdentifiers/);
  });

  it('rejects a requiredDocumentFields entry missing field/label/why', () => {
    const fact = baseFact({
      requiredDocumentFields: [{ field: 'buyerReference', label: '', why: 'because', required: true }],
    });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/requiredDocumentFields/);
  });

  it('rejects a requiredDocumentFields entry with a non-boolean "required"', () => {
    const fact = baseFact({
      requiredDocumentFields: [
        { field: 'buyerReference', label: 'Leitweg-ID', why: 'because', required: undefined as never },
      ],
    });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).toThrow(/"required"/);
  });

  it('accepts well-formed requiredClientIdentifiers and requiredDocumentFields together', () => {
    const fact = baseFact({
      requiredClientIdentifiers: [{ scheme: 'LEGAL_ID', label: 'SIRET', why: 'because' }],
      requiredDocumentFields: [
        { field: 'buyerReference', label: 'Leitweg-ID', why: 'because', required: true },
      ],
    });
    expect(() => assertValidB2gRoutingFact(fact, 'test')).not.toThrow();
  });
});

import { assertValidProvenance, IdentifierSchemeFact, InvalidIdentifierProvenanceError } from './schema';

const base: Omit<IdentifierSchemeFact, 'provenance'> = {
  scheme: 'LEGAL_ID',
  appliesTo: 'BOTH',
  label: 'SIRET',
  required: true,
};

describe('assertValidProvenance', () => {
  it('accepts a well-formed "legal" fact', () => {
    expect(() =>
      assertValidProvenance(
        {
          ...base,
          provenance: { kind: 'legal', sourceText: 'Some exact legal text.', sourceCheckedAt: '2026-08-30' },
        },
        'test',
      ),
    ).not.toThrow();
  });

  it('accepts a well-formed "unverified" fact', () => {
    expect(() =>
      assertValidProvenance(
        { ...base, provenance: { kind: 'unverified', resolutionNote: 'What would settle this.' } },
        'test',
      ),
    ).not.toThrow();
  });

  it('rejects a fact with no provenance at all', () => {
    expect(() => assertValidProvenance({ ...base, provenance: undefined as never }, 'test')).toThrow(
      InvalidIdentifierProvenanceError,
    );
  });

  it('rejects a provenance with an unrecognized kind', () => {
    expect(() =>
      assertValidProvenance({ ...base, provenance: { kind: 'trust-me' } as never }, 'test'),
    ).toThrow(/no valid provenance/);
  });

  it('rejects "legal" missing sourceText', () => {
    expect(() =>
      assertValidProvenance(
        { ...base, provenance: { kind: 'legal', sourceCheckedAt: '2026-08-30' } as never },
        'test',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "legal" with an empty sourceText', () => {
    expect(() =>
      assertValidProvenance(
        { ...base, provenance: { kind: 'legal', sourceText: '   ', sourceCheckedAt: '2026-08-30' } },
        'test',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "legal" missing sourceCheckedAt', () => {
    expect(() =>
      assertValidProvenance({ ...base, provenance: { kind: 'legal', sourceText: 'Text.' } as never }, 'test'),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "unverified" missing resolutionNote', () => {
    expect(() =>
      assertValidProvenance({ ...base, provenance: { kind: 'unverified' } as never }, 'test'),
    ).toThrow(/no resolutionNote/);
  });

  it('rejects "unverified" with a blank resolutionNote', () => {
    expect(() =>
      assertValidProvenance({ ...base, provenance: { kind: 'unverified', resolutionNote: '  ' } }, 'test'),
    ).toThrow(/no resolutionNote/);
  });

  it('names the scheme and the caller-supplied context in the error, so a failure says where to look', () => {
    expect(() => assertValidProvenance({ ...base, provenance: undefined as never }, 'fr.json')).toThrow(
      /fr\.json.*LEGAL_ID/,
    );
  });
});

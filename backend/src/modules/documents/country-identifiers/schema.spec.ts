import {
  assertPatternIsExplainable,
  assertValidEinvoiceFacts,
  assertValidProvenance,
  IdentifierSchemeFact,
  InvalidEinvoiceIdentifierFactError,
  InvalidIdentifierPatternError,
  InvalidIdentifierProvenanceError,
} from './schema';

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

describe('assertPatternIsExplainable', () => {
  const legal = { kind: 'legal', sourceText: 'Text.', sourceCheckedAt: '2026-08-30' } as const;

  it('accepts a fact with no pattern at all — nothing to explain', () => {
    expect(() => assertPatternIsExplainable({ ...base, provenance: legal }, 'test')).not.toThrow();
  });

  it('accepts a fact whose pattern carries its own helpText', () => {
    expect(() =>
      assertPatternIsExplainable(
        { ...base, pattern: '^\\d{9}$', helpText: '9 digits.', provenance: legal },
        'test',
      ),
    ).not.toThrow();
  });

  it('rejects a pattern with no helpText — a refusal at write time would have no words to explain it', () => {
    expect(() =>
      assertPatternIsExplainable({ ...base, pattern: '^\\d{9}$', provenance: legal }, 'test'),
    ).toThrow(InvalidIdentifierPatternError);
  });

  it('rejects a pattern with a blank helpText the same way', () => {
    expect(() =>
      assertPatternIsExplainable(
        { ...base, pattern: '^\\d{9}$', helpText: '   ', provenance: legal },
        'test',
      ),
    ).toThrow(InvalidIdentifierPatternError);
  });

  it('names the scheme, the pattern, and the caller-supplied context', () => {
    expect(() =>
      assertPatternIsExplainable({ ...base, pattern: '^\\d{9}$', provenance: legal }, 'it.json'),
    ).toThrow(/it\.json.*LEGAL_ID.*\^\\d\{9\}\$/);
  });
});

describe('assertValidEinvoiceFacts', () => {
  const legal = { kind: 'legal', sourceText: 'Text.', sourceCheckedAt: '2026-08-30' } as const;
  const check = (facts: Partial<IdentifierSchemeFact>) => () =>
    assertValidEinvoiceFacts({ ...base, ...facts, provenance: legal }, 'test');

  it('accepts four-digit schemes and a reduction that keeps fewer digits', () => {
    expect(
      check({
        iso6523Scheme: '0002',
        electronicAddressScheme: '0225',
        einvoiceReduction: { whenDigits: 14, keepDigits: 9 },
      }),
    ).not.toThrow();
  });

  it.each([
    ['an iso6523Scheme that is not four digits', { iso6523Scheme: '2' }],
    ['an electronicAddressScheme that is not four digits', { electronicAddressScheme: 'FR' }],
    ['a reduction that keeps every digit', { einvoiceReduction: { whenDigits: 9, keepDigits: 9 } }],
    ['a reduction that keeps nothing', { einvoiceReduction: { whenDigits: 14, keepDigits: 0 } }],
  ])('rejects %s', (_label, facts) => {
    expect(check(facts as Partial<IdentifierSchemeFact>)).toThrow(InvalidEinvoiceIdentifierFactError);
  });
});

import { assertValidVatRateProvenance, InvalidVatRateProvenanceError, VatRateFact } from './schema';

const base: Omit<VatRateFact, 'provenance'> = {
  id: 'xx-standard',
  rate: 20,
  label: 'Standard',
  category: 'STANDARD',
};

describe('assertValidVatRateProvenance', () => {
  it('accepts a well-formed "legal" rate', () => {
    expect(() =>
      assertValidVatRateProvenance(
        {
          ...base,
          provenance: { kind: 'legal', sourceText: 'Some exact legal text.', sourceCheckedAt: '2026-08-30' },
        },
        'test',
      ),
    ).not.toThrow();
  });

  it('accepts a well-formed "unverified" rate', () => {
    expect(() =>
      assertValidVatRateProvenance(
        { ...base, provenance: { kind: 'unverified', resolutionNote: 'What would settle this.' } },
        'test',
      ),
    ).not.toThrow();
  });

  it('rejects a rate with no provenance at all', () => {
    expect(() => assertValidVatRateProvenance({ ...base, provenance: undefined as never }, 'test')).toThrow(
      InvalidVatRateProvenanceError,
    );
  });

  it('rejects a provenance with an unrecognized kind', () => {
    expect(() =>
      assertValidVatRateProvenance({ ...base, provenance: { kind: 'trust-me' } as never }, 'test'),
    ).toThrow(/no valid provenance/);
  });

  it('rejects "legal" missing sourceText', () => {
    expect(() =>
      assertValidVatRateProvenance(
        { ...base, provenance: { kind: 'legal', sourceCheckedAt: '2026-08-30' } as never },
        'test',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "legal" with an empty sourceText', () => {
    expect(() =>
      assertValidVatRateProvenance(
        { ...base, provenance: { kind: 'legal', sourceText: '   ', sourceCheckedAt: '2026-08-30' } },
        'test',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "unverified" missing resolutionNote', () => {
    expect(() =>
      assertValidVatRateProvenance({ ...base, provenance: { kind: 'unverified' } as never }, 'test'),
    ).toThrow(/no resolutionNote/);
  });

  it('rejects "unverified" with a blank resolutionNote', () => {
    expect(() =>
      assertValidVatRateProvenance(
        { ...base, provenance: { kind: 'unverified', resolutionNote: '  ' } },
        'test',
      ),
    ).toThrow(/no resolutionNote/);
  });

  it('names the rate id and the caller-supplied context in the error', () => {
    expect(() =>
      assertValidVatRateProvenance({ ...base, provenance: undefined as never }, 'fr.json'),
    ).toThrow(/fr\.json.*xx-standard/);
  });
});

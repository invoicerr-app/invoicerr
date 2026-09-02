import { assertValidReportingObligationFact, InvalidReportingObligationProvenanceError } from './schema';

describe('reporting obligation fact validation', () => {
  it('accepts a well-formed legal fact', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          provenance: { kind: 'legal', sourceText: 'Some exact legal text.', sourceCheckedAt: '2026-09-02' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('accepts a well-formed unverified fact — no "suggested/mandated" tier exists here', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'mydata',
          appliesTo: 'invoice',
          provenance: { kind: 'unverified', resolutionNote: 'not yet confirmed at the primary source' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects a fact with no providerId', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { providerId: '', appliesTo: 'invoice', provenance: { kind: 'unverified', resolutionNote: 'x' } },
        'fixture',
      ),
    ).toThrow(/missing its "providerId"/);
  });

  it('rejects an invalid "appliesTo"', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'quote' as never,
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/no valid "appliesTo"/);
  });

  it('rejects a fact with no provenance at all', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { providerId: 'nav', appliesTo: 'invoice', provenance: {} as never },
        'fixture',
      ),
    ).toThrow(InvalidReportingObligationProvenanceError);
  });

  it('rejects "legal" provenance missing sourceText/sourceCheckedAt', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { providerId: 'nav', appliesTo: 'invoice', provenance: { kind: 'legal' } as never },
        'fixture',
      ),
    ).toThrow(/missing sourceText/);
  });

  it('rejects "unverified" provenance missing a resolutionNote', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'mydata',
          appliesTo: 'invoice',
          provenance: { kind: 'unverified', resolutionNote: '   ' },
        },
        'fixture',
      ),
    ).toThrow(/no resolutionNote/);
  });
});

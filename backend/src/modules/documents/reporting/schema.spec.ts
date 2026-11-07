import { assertValidReportingObligationFact, InvalidReportingObligationProvenanceError } from './schema';

describe('reporting obligation fact validation', () => {
  it('accepts a well-formed legal fact', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
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
          dischargedBy: 'provider',
          provenance: { kind: 'unverified', resolutionNote: 'not yet confirmed at the primary source' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects a fact with no providerId', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: '',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
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
          dischargedBy: 'provider',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/no valid "appliesTo"/);
  });

  it('rejects a fact with no provenance at all', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { providerId: 'nav', appliesTo: 'invoice', dischargedBy: 'provider', provenance: {} as never },
        'fixture',
      ),
    ).toThrow(InvalidReportingObligationProvenanceError);
  });

  it('rejects "legal" provenance missing sourceText/sourceCheckedAt', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          provenance: { kind: 'legal' } as never,
        },
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
          dischargedBy: 'provider',
          provenance: { kind: 'unverified', resolutionNote: '   ' },
        },
        'fixture',
      ),
    ).toThrow(/no resolutionNote/);
  });

  // --- dischargedBy — the axis France's PDP forced onto this schema -------------------------------

  it('accepts a "transport"-discharged fact — no scope, no applicableFrom required', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'pdp',
          appliesTo: 'invoice',
          dischargedBy: 'transport',
          provenance: { kind: 'legal', sourceText: 'CGI art. 289 E.', sourceCheckedAt: '2026-09-16' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects an invalid "dischargedBy"', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'email' as never,
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/no valid "dischargedBy"/);
  });

  it('rejects a fact with no "dischargedBy" at all', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        } as never,
        'fixture',
      ),
    ).toThrow(/no valid "dischargedBy"/);
  });

  // --- scope — the transaction-category axis --------------------------------------------------

  it('accepts a fact scoped to several transaction categories', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'fr-ereporting',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          scope: [{ transactions: 'b2c' }, { transactions: 'international' }],
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('accepts a fact with no scope at all — means "every transaction", the pre-existing behaviour', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'pt-at',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-11' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects an unknown scope transaction category', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'fr-ereporting',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          scope: [{ transactions: 'b2b-foreign' as never }],
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/unknown scope transaction category/);
  });

  it('rejects an empty scope array — omit the field entirely instead', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'fr-ereporting',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          scope: [],
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/not a non-empty array/);
  });

  // --- applicableFrom — its own, independent provenance ------------------------------------------

  it('accepts a fact with a sourced applicableFrom date', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          applicableFrom: {
            date: '2026-01-01',
            provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-16' },
          },
          provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-16' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects an applicableFrom with no date', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          applicableFrom: {
            date: '',
            provenance: { kind: 'unverified', resolutionNote: 'x' },
          },
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/applicableFrom" with no "date"/);
  });

  it("rejects an applicableFrom whose OWN provenance is invalid, independently of the fact's own", () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          providerId: 'nav',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          applicableFrom: { date: '2026-01-01', provenance: {} as never },
          provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-16' },
        },
        'fixture',
      ),
    ).toThrow(/applicableFrom has no valid provenance/);
  });
});

describe('reporting obligation scope and applicability validation', () => {
  const base = {
    providerId: 'fr-pa',
    appliesTo: 'invoice' as const,
    dischargedBy: 'provider' as const,
    provenance: { kind: 'legal' as const, sourceText: 'x', sourceCheckedAt: '2026-10-24' },
  };

  it('accepts a scoped fact with buyer type, establishment and the VAT-on-collection condition', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          ...base,
          scope: [
            { transactions: 'b2c', buyerType: ['INDIVIDUAL'], buyerEstablishment: 'domestic' },
            { transactions: 'payments', buyerType: ['INDIVIDUAL'], vatOnCollection: true },
          ],
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('rejects an empty buyerType list', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { ...base, scope: [{ transactions: 'b2c', buyerType: [] }] },
        'fixture',
      ),
    ).toThrow(/empty "scope.buyerType"/);
  });

  it('rejects an unknown buyer type', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { ...base, scope: [{ transactions: 'b2c', buyerType: ['BUSINESS'] as never }] },
        'fixture',
      ),
    ).toThrow(/unknown "scope.buyerType" party type "BUSINESS"/);
  });

  it('rejects an unknown buyer establishment', () => {
    expect(() =>
      assertValidReportingObligationFact(
        { ...base, scope: [{ transactions: 'b2c', buyerEstablishment: 'eu' as never }] },
        'fixture',
      ),
    ).toThrow(/unknown "scope.buyerEstablishment"/);
  });

  it('accepts size-tiered applicability windows and rejects one without a date', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          ...base,
          applicability: [
            {
              when: { companyProfile: { sizeCategory: ['LARGE', 'MID'] } },
              from: {
                date: '2026-09-01',
                provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-10-24' },
              },
            },
          ],
        },
        'fixture',
      ),
    ).not.toThrow();

    expect(() =>
      assertValidReportingObligationFact(
        {
          ...base,
          applicability: [
            {
              from: {
                date: '',
                provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-10-24' },
              },
            },
          ],
        },
        'fixture',
      ),
    ).toThrow(/applicability window with no "from.date"/);
  });

  it('rejects a profile condition with an empty value list', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          ...base,
          applicability: [
            {
              when: { companyProfile: { sizeCategory: [] } },
              from: {
                date: '2026-09-01',
                provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-10-24' },
              },
            },
          ],
        },
        'fixture',
      ),
    ).toThrow(/no non-empty value list/);
  });

  it('rejects an applicability window whose own provenance is invalid', () => {
    expect(() =>
      assertValidReportingObligationFact(
        {
          ...base,
          applicability: [{ from: { date: '2026-09-01', provenance: {} as never } }],
        },
        'fixture',
      ),
    ).toThrow(/applicability window \(2026-09-01\) has no valid provenance/);
  });
});

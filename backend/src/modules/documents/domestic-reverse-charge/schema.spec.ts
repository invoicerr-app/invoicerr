import {
  assertValidDomesticReverseChargeCategory,
  DomesticReverseChargeCategoryFact,
  InvalidDomesticReverseChargeProvenanceError,
} from './schema';

const legal: DomesticReverseChargeCategoryFact = {
  key: 'construction-subcontracting',
  label: 'Construction subcontracting',
  legalRef: 'CGI art. 283, 2 nonies',
  provenance: {
    kind: 'legal',
    sourceText: 'la taxe est acquittée par le preneur.',
    sourceCheckedAt: '2026-09-13',
  },
};

const unverified: DomesticReverseChargeCategoryFact = {
  key: 'some-category',
  label: 'Some category',
  legalRef: 'Some article',
  provenance: {
    kind: 'unverified',
    resolutionNote: 'Would need to be checked against the primary source.',
  },
};

describe('assertValidDomesticReverseChargeCategory', () => {
  it('accepts a well-formed legal category', () => {
    expect(() => assertValidDomesticReverseChargeCategory(legal, 'test')).not.toThrow();
  });

  it('accepts a well-formed unverified category', () => {
    expect(() => assertValidDomesticReverseChargeCategory(unverified, 'test')).not.toThrow();
  });

  // The mutation this whole catalog exists to make impossible: a fact with no provenance at all must
  // NEVER load — same "a fact without a citation does not load" discipline every sibling catalog
  // (`country-policy/`, `channel-policy/`, `mentions/`) already enforces for its own concern.
  it('refuses a category with no provenance at all', () => {
    const bare = { ...legal, provenance: undefined as never };
    expect(() => assertValidDomesticReverseChargeCategory(bare, 'test')).toThrow(
      InvalidDomesticReverseChargeProvenanceError,
    );
    expect(() => assertValidDomesticReverseChargeCategory(bare, 'test')).toThrow(/no valid provenance/);
  });

  it('refuses a category whose provenance.kind is neither "legal" nor "unverified"', () => {
    const bogus = { ...legal, provenance: { kind: 'made-up' } as never };
    expect(() => assertValidDomesticReverseChargeCategory(bogus, 'test')).toThrow(
      InvalidDomesticReverseChargeProvenanceError,
    );
  });

  it('refuses a "legal" category missing sourceText', () => {
    const broken = {
      ...legal,
      provenance: { kind: 'legal' as const, sourceText: '', sourceCheckedAt: '2026-09-13' },
    };
    expect(() => assertValidDomesticReverseChargeCategory(broken, 'test')).toThrow(/missing sourceText/);
  });

  it('refuses a "legal" category missing sourceCheckedAt', () => {
    const broken = {
      ...legal,
      provenance: { kind: 'legal' as const, sourceText: 'some text', sourceCheckedAt: '' },
    };
    expect(() => assertValidDomesticReverseChargeCategory(broken, 'test')).toThrow(/missing sourceText/);
  });

  it('refuses an "unverified" category with no resolutionNote', () => {
    const broken = { ...unverified, provenance: { kind: 'unverified' as const, resolutionNote: '' } };
    expect(() => assertValidDomesticReverseChargeCategory(broken, 'test')).toThrow(/no resolutionNote/);
  });

  it('refuses a category with no key', () => {
    expect(() => assertValidDomesticReverseChargeCategory({ ...legal, key: '' }, 'test')).toThrow(/no "key"/);
  });

  it('refuses a category with no label', () => {
    expect(() => assertValidDomesticReverseChargeCategory({ ...legal, label: '' }, 'test')).toThrow(
      /no "label"/,
    );
  });

  it('refuses a category with no legalRef, even when provenance is otherwise well-formed', () => {
    expect(() => assertValidDomesticReverseChargeCategory({ ...legal, legalRef: '' }, 'test')).toThrow(
      /no "legalRef"/,
    );
  });

  it('accepts a category with a well-formed validUntil', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory({ ...legal, validUntil: '2026-12-31' }, 'test'),
    ).not.toThrow();
  });

  it('accepts a category with a well-formed validFrom', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory({ ...legal, validFrom: '2026-07-01' }, 'test'),
    ).not.toThrow();
  });

  it('accepts a category with both, validFrom on or before validUntil', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory(
        { ...legal, validFrom: '2026-01-01', validUntil: '2026-12-31' },
        'test',
      ),
    ).not.toThrow();
  });

  it('refuses a malformed validUntil', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory({ ...legal, validUntil: '31/12/2026' }, 'test'),
    ).toThrow(/invalid "validUntil"/);
  });

  it('refuses a malformed validFrom', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory({ ...legal, validFrom: 'not-a-date' }, 'test'),
    ).toThrow(/invalid "validFrom"/);
  });

  it('refuses a validUntil that does not correspond to a real calendar date', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory({ ...legal, validUntil: '2026-13-40' }, 'test'),
    ).toThrow(/invalid "validUntil"/);
  });

  it('refuses validFrom after validUntil', () => {
    expect(() =>
      assertValidDomesticReverseChargeCategory(
        { ...legal, validFrom: '2027-01-01', validUntil: '2026-12-31' },
        'test',
      ),
    ).toThrow(/after "validUntil"/);
  });
});

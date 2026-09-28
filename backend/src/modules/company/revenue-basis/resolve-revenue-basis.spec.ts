import {
  defaultRevenueBasisFor,
  normalizeRevenueBasis,
  normalizeRevenuePeriod,
  resolveRevenueSettings,
} from './resolve-revenue-basis';

describe('defaultRevenueBasisFor', () => {
  it('FR: cashed (URSSAF micro-entrepreneur)', () => {
    expect(defaultRevenueBasisFor('FR').basis).toBe('cashed');
  });

  it('IT: cashed (regime forfettario)', () => {
    expect(defaultRevenueBasisFor('IT').basis).toBe('cashed');
  });

  it('DE: invoiced (VAT stays accrual by default, only income tax is cashed)', () => {
    expect(defaultRevenueBasisFor('DE').basis).toBe('invoiced');
  });

  it('PL: invoiced (kasowy PIT is an explicit opt-in)', () => {
    expect(defaultRevenueBasisFor('PL').basis).toBe('invoiced');
  });

  it('PT: invoiced (CIRS ties the taxable moment to invoicing, IVA de caixa is opt-in)', () => {
    expect(defaultRevenueBasisFor('PT').basis).toBe('invoiced');
  });

  it('an unresearched/unknown country: invoiced, the unchanged pre-existing behavior', () => {
    expect(defaultRevenueBasisFor('US').basis).toBe('invoiced');
    expect(defaultRevenueBasisFor(null).basis).toBe('invoiced');
    expect(defaultRevenueBasisFor(undefined).basis).toBe('invoiced');
  });

  it('is case-insensitive and trims', () => {
    expect(defaultRevenueBasisFor(' fr ').basis).toBe('cashed');
  });

  it('carries a sourced reason', () => {
    expect(defaultRevenueBasisFor('FR').reason).toMatch(/urssaf/i);
    expect(defaultRevenueBasisFor('IT').reason).toMatch(/forfettario/i);
  });
});

describe('resolveRevenueSettings', () => {
  it('no explicit basis/period: resolves to the country default and "monthly", marked not explicit', () => {
    const resolved = resolveRevenueSettings({ revenueBasis: null, revenuePeriod: null, countryCode: 'FR' });
    expect(resolved).toMatchObject({
      basis: 'cashed',
      period: 'monthly',
      basisIsExplicit: false,
      periodIsExplicit: false,
    });
  });

  it('an explicit basis overrides the country default, and is marked explicit', () => {
    const resolved = resolveRevenueSettings({
      revenueBasis: 'invoiced',
      revenuePeriod: null,
      countryCode: 'FR',
    });
    expect(resolved.basis).toBe('invoiced');
    expect(resolved.basisIsExplicit).toBe(true);
  });

  it('an explicit basis EQUAL to the default is still reported as explicit, not as unset', () => {
    const resolved = resolveRevenueSettings({
      revenueBasis: 'cashed',
      revenuePeriod: null,
      countryCode: 'FR',
    });
    expect(resolved.basis).toBe('cashed');
    expect(resolved.basisIsExplicit).toBe(true);
  });

  it('an explicit quarterly period is honored and marked explicit', () => {
    const resolved = resolveRevenueSettings({
      revenueBasis: null,
      revenuePeriod: 'quarterly',
      countryCode: 'DE',
    });
    expect(resolved.period).toBe('quarterly');
    expect(resolved.periodIsExplicit).toBe(true);
  });

  it('a stored value this resolver does not recognize is treated as unset, never thrown', () => {
    const resolved = resolveRevenueSettings({
      revenueBasis: 'some-corrupted-value',
      revenuePeriod: 'weekly',
      countryCode: 'FR',
    });
    expect(resolved.basis).toBe('cashed'); // falls back to the FR default
    expect(resolved.basisIsExplicit).toBe(false);
    expect(resolved.period).toBe('monthly');
    expect(resolved.periodIsExplicit).toBe(false);
  });
});

describe('normalizeRevenueBasis', () => {
  it('undefined stays undefined - leaves the column untouched', () => {
    expect(normalizeRevenueBasis(undefined)).toBeUndefined();
  });

  it('null/empty clears it back to "use the default"', () => {
    expect(normalizeRevenueBasis(null)).toBeNull();
    expect(normalizeRevenueBasis('  ')).toBeNull();
  });

  it('accepts "invoiced"/"cashed", normalized to lowercase', () => {
    expect(normalizeRevenueBasis('Invoiced')).toBe('invoiced');
    expect(normalizeRevenueBasis('CASHED')).toBe('cashed');
  });

  it('rejects anything else, named, rather than storing it silently', () => {
    expect(() => normalizeRevenueBasis('sometimes')).toThrow(/revenueBasis must be/);
  });
});

describe('normalizeRevenuePeriod', () => {
  it('accepts "monthly"/"quarterly"', () => {
    expect(normalizeRevenuePeriod('Monthly')).toBe('monthly');
    expect(normalizeRevenuePeriod('QUARTERLY')).toBe('quarterly');
  });

  it('rejects anything else, named', () => {
    expect(() => normalizeRevenuePeriod('yearly')).toThrow(/revenuePeriod must be/);
  });
});

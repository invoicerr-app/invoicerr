import {
  assertValidContentRequirementFact,
  ContentRequirementFact,
  InvalidContentRequirementFactError,
} from './schema';

const VALID: ContentRequirementFact = {
  field: 'BT-23',
  mandatedFrom: '2026-09-01',
  provenance: { kind: 'legal', sourceText: 'Some exact statutory text.', sourceCheckedAt: '2026-08-31' },
};

describe('assertValidContentRequirementFact', () => {
  it('accepts a well-formed fact', () => {
    expect(() => assertValidContentRequirementFact(VALID, 'ctx')).not.toThrow();
  });

  it('refuses a fact with no field', () => {
    expect(() => assertValidContentRequirementFact({ ...VALID, field: '' }, 'ctx')).toThrow(
      InvalidContentRequirementFactError,
    );
  });

  it('refuses a fact with no mandatedFrom', () => {
    expect(() => assertValidContentRequirementFact({ ...VALID, mandatedFrom: '' }, 'ctx')).toThrow(
      /mandatedFrom/,
    );
  });

  it('refuses a fact with "unverified" provenance — a content requirement is always a legal claim', () => {
    const withUnverified = {
      ...VALID,
      provenance: { kind: 'unverified', resolutionNote: 'not checked yet' },
    } as unknown as ContentRequirementFact;
    expect(() => assertValidContentRequirementFact(withUnverified, 'ctx')).toThrow(/legal/);
  });

  it('refuses "legal" provenance missing sourceText', () => {
    const bad = { ...VALID, provenance: { kind: 'legal', sourceText: '', sourceCheckedAt: '2026-08-31' } };
    expect(() => assertValidContentRequirementFact(bad as ContentRequirementFact, 'ctx')).toThrow(
      /sourceText/,
    );
  });

  it('refuses "legal" provenance missing sourceCheckedAt', () => {
    const bad = { ...VALID, provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '' } };
    expect(() => assertValidContentRequirementFact(bad as ContentRequirementFact, 'ctx')).toThrow(
      /sourceCheckedAt/,
    );
  });
});

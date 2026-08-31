import { assertValidRetentionRule, InvalidRetentionRuleError, RetentionRule } from './schema';

const base: Omit<RetentionRule, 'legalRef'> = { label: 'fiscale', years: 6 };

describe('assertValidRetentionRule', () => {
  it('accepts a well-formed rule with a legalRef', () => {
    expect(() => assertValidRetentionRule({ ...base, legalRef: 'LPF art. L102 B' }, 'test')).not.toThrow();
  });

  // The mutation this exact test rehearses: a retention duration with no legalRef must NEVER load —
  // the same "a legal claim without a citation does not load" discipline `mentions/schema.spec.ts`
  // already proves for a mandatory mention, and this task's own rule: no duration is ever invented.
  it('rejects a rule with no legalRef at all', () => {
    expect(() => assertValidRetentionRule({ ...base, legalRef: '' }, 'test')).toThrow(
      InvalidRetentionRuleError,
    );
    expect(() => assertValidRetentionRule({ ...base, legalRef: '' }, 'test')).toThrow(/no "legalRef"/);
  });

  it('rejects a rule with a whitespace-only legalRef', () => {
    expect(() => assertValidRetentionRule({ ...base, legalRef: '   ' }, 'test')).toThrow(
      InvalidRetentionRuleError,
    );
  });

  it('rejects a rule with no label', () => {
    expect(() =>
      assertValidRetentionRule({ label: '', years: 6, legalRef: 'LPF art. L102 B' }, 'test'),
    ).toThrow(/no "label"/);
  });

  it('rejects a rule with a zero or negative years', () => {
    expect(() =>
      assertValidRetentionRule({ ...base, years: 0, legalRef: 'LPF art. L102 B' }, 'test'),
    ).toThrow(/positive numeric "years"/);
    expect(() =>
      assertValidRetentionRule({ ...base, years: -1, legalRef: 'LPF art. L102 B' }, 'test'),
    ).toThrow(/positive numeric "years"/);
  });

  it('rejects a rule with a non-numeric years', () => {
    expect(() =>
      assertValidRetentionRule(
        { ...base, years: 'six' as unknown as number, legalRef: 'LPF art. L102 B' },
        'test',
      ),
    ).toThrow(/positive numeric "years"/);
  });
});

/**
 * Coverage guard for the SHIPPED retention catalog — same role `mentions/data/all.spec.ts` plays for
 * its own file.
 */
import { assertValidRetentionRule } from '../schema';
import { ALL_RETENTION_FILES } from './all';

describe('archive/retention/data — the shipped FR catalog', () => {
  it('loads exactly France today — the country this task’s own repère sourced', () => {
    expect(ALL_RETENTION_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });

  it('every rule in every shipped file has already passed assertValidRetentionRule at load time', () => {
    for (const file of ALL_RETENTION_FILES) {
      for (const rule of file.rules) {
        expect(() => assertValidRetentionRule(rule, 'test')).not.toThrow();
      }
    }
  });

  it('FR declares BOTH the fiscal (6y, LPF L102 B) and commercial (10y, C. com. L123-22) durations', () => {
    const fr = ALL_RETENTION_FILES.find((f) => f.countryCode === 'FR');
    expect(fr?.rules).toEqual([
      expect.objectContaining({ label: 'fiscale', years: 6, legalRef: 'LPF art. L102 B' }),
      expect.objectContaining({ label: 'commerciale', years: 10, legalRef: 'C. com. art. L123-22' }),
    ]);
  });

  it('every FR rule carries a real legalRef — no duration invented', () => {
    const fr = ALL_RETENTION_FILES.find((f) => f.countryCode === 'FR');
    for (const rule of fr?.rules ?? []) {
      expect(rule.legalRef?.trim()).toBeTruthy();
    }
  });
});

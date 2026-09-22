/**
 * Coverage guard for the SHIPPED retention catalog — same role `mentions/data/all.spec.ts` plays for
 * its own file.
 */
import { assertValidRetentionRule } from '../schema';
import { ALL_RETENTION_FILES } from './all';

describe('archive/retention/data — the shipped catalog', () => {
  // Deliberately hard-pinned, not "contains" — see this suite's own header. Updated 2026-09-13 when
  // `all.ts` moved to auto-discovery (previously a hand-maintained `COUNTRY_FILES` array) and DE/PL/PT
  // were added: France's own two SIMULTANEOUS rules stay as they were, Germany (UStG § 14b + AO § 147),
  // Poland (ustawa o VAT art. 112 -> Ordynacja podatkowa art. 70 § 1) and Portugal (CIVA art. 52.º) were
  // newly sourced. Italy was investigated and deliberately left OUT — see the retention work's own
  // report for exactly why (normattiva.it would not come down as raw text). Update this list
  // deliberately, alongside the delivered work, never loosen it to "contains" or "at least".
  it("loads exactly DE, FR, PL and PT today — see this test's own comment for what was investigated and left out", () => {
    expect(ALL_RETENTION_FILES.map((f) => f.countryCode)).toEqual(['DE', 'FR', 'PL', 'PT']);
  });

  it('every rule in every shipped file has already passed assertValidRetentionRule at load time', () => {
    for (const file of ALL_RETENTION_FILES) {
      for (const rule of file.rules) {
        expect(() => assertValidRetentionRule(rule, 'test')).not.toThrow();
      }
    }
  });

  it('FR declares BOTH the fiscal (6y, LPF L102 B, from the exact issue date) and commercial (10y, C. com. L123-22, safe fiscal-year-close approximation) durations', () => {
    const fr = ALL_RETENTION_FILES.find((f) => f.countryCode === 'FR');
    expect(fr?.rules).toEqual([
      expect.objectContaining({
        label: 'fiscale',
        years: 6,
        origin: 'issueDate',
        legalRef: 'LPF art. L102 B',
      }),
      expect.objectContaining({
        label: 'commerciale',
        years: 10,
        origin: 'fiscalYearEndUnknownSafe',
        legalRef: 'C. com. art. L123-22',
      }),
    ]);
  });

  it('DE declares BOTH the UStG and AO obligations, each 8y from the end of the calendar year of issue', () => {
    const de = ALL_RETENTION_FILES.find((f) => f.countryCode === 'DE');
    expect(de?.rules).toEqual([
      expect.objectContaining({ label: 'umsatzsteuerlich', years: 8, origin: 'issueDateYearEnd' }),
      expect.objectContaining({ label: 'abgabenrechtlich', years: 8, origin: 'issueDateYearEnd' }),
    ]);
  });

  it('PT declares the CIVA obligation, 10y from the end of the calendar year of issue', () => {
    const pt = ALL_RETENTION_FILES.find((f) => f.countryCode === 'PT');
    expect(pt?.rules).toEqual([
      expect.objectContaining({
        label: 'IVA',
        years: 10,
        origin: 'issueDateYearEnd',
        legalRef: 'CIVA art. 52.º n.º 1',
      }),
    ]);
  });

  it('PL declares the VAT obligation, 5y from the safe (never-shorter) tax-deadline-year-end approximation', () => {
    const pl = ALL_RETENTION_FILES.find((f) => f.countryCode === 'PL');
    expect(pl?.rules).toEqual([
      expect.objectContaining({
        label: 'VAT',
        years: 5,
        origin: 'taxDeadlineYearEndUnknownSafe',
        legalRef: 'ustawa o VAT art. 112, renvoi vers Ordynacja podatkowa art. 70 § 1',
      }),
    ]);
  });

  it('every shipped rule carries a real legalRef — no duration invented', () => {
    for (const file of ALL_RETENTION_FILES) {
      for (const rule of file.rules) {
        expect(rule.legalRef?.trim()).toBeTruthy();
      }
    }
  });
});

/**
 * Coverage guard for the SHIPPED mentions catalog — same role `vat-rates/data/all.spec.ts` and
 * `transports/channel-policy/data/all.ts`'s own loader tests play for their own files.
 */
import { assertValidMentionRule } from '../schema';
import { ALL_MENTIONS_FILES } from './all';

describe('mentions/data — the shipped FR catalog', () => {
  it('loads exactly France today — this task’s own scope', () => {
    expect(ALL_MENTIONS_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });

  it('every mention in every shipped file has already passed assertValidMentionRule at load time', () => {
    for (const file of ALL_MENTIONS_FILES) {
      for (const entry of file.invoiceNotes) {
        expect(() => assertValidMentionRule(entry, 'test')).not.toThrow();
      }
    }
  });

  it('FR declares PMT, PMD and AAB — the three mentions of L441-9 I al. 5, none invented', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const codes = (fr?.invoiceNotes ?? []).map((e) => e.value.subjectCode);
    expect(codes).toEqual(['PMT', 'PMD', 'AAB']);
  });

  it('every FR mention is statutory — none is a commercial choice this codebase would be inventing', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    for (const entry of fr?.invoiceNotes ?? []) {
      expect(entry.value.statutory).toBe(true);
    }
  });

  it('every FR mention carries a real legalRef — the discipline this task’s brief names by name', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    for (const entry of fr?.invoiceNotes ?? []) {
      expect(entry.value.legalRef?.trim()).toBeTruthy();
    }
  });

  it('FR’s late-payment rate table has both known semesters of 2026, each with a distinct value', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const table = fr?.noteValues?.lateFeeRate ?? [];
    expect(table.map((t) => t.value)).toEqual(['12,15 %', '12,40 %']);
  });
});

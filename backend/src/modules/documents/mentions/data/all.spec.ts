/**
 * Coverage guard for the SHIPPED mentions catalog — same role `vat-rates/data/all.spec.ts` and
 * `transports/channel-policy/data/all.ts`'s own loader tests play for their own files.
 */
import { assertValidMentionRule } from '../schema';
import { ALL_MENTIONS_FILES } from './all';

describe('mentions/data — the shipped FR catalog', () => {
  it('loads exactly France today', () => {
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

  it('every FR mention carries a real legalRef', () => {
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

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('mentions/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_MENTIONS_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_MENTIONS_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});

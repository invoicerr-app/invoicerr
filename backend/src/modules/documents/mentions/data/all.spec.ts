/**
 * Coverage guard for the SHIPPED mentions catalog -- same role `vat-rates/data/all.spec.ts` and
 * `transports/channel-policy/data/all.ts`'s own loader tests play for their own files.
 */
import { assertValidMentionRule } from '../schema';
import { ALL_MENTIONS_FILES } from './all';

describe('mentions/data -- the shipped FR catalog', () => {
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

  it('FR declares PMT, PMD and AAB -- the three mentions of L441-9 I al. 5, none invented', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const codes = (fr?.invoiceNotes ?? []).map((e) => e.value.subjectCode);
    expect(codes).toEqual(['PMT', 'PMD', 'AAB']);
  });

  it('every FR mention is statutory -- none is a commercial choice this codebase would be inventing', () => {
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

  it('PMD declares a fallbackText -- issue #519, so a send is never blocked by lateFeeRate running out', () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const pmd = (fr?.invoiceNotes ?? []).find((e) => e.value.subjectCode === 'PMD');
    expect(pmd?.value.fallbackText?.trim()).toBeTruthy();
    // The fallback must never itself carry a placeholder -- it is meant to need no table lookup once
    // used (invoice-notes.ts's own `resolveNoteText` never re-interpolates it).
    expect(pmd?.value.fallbackText).not.toMatch(/\{\w+\}/);
  });

  // THE CANARY (issue #519): lateFeeRate's own value table is read again every 1 January and 1 July
  // (C. com. art. L441-10 II) -- this checks the REAL wall clock against the REAL shipped table, so it
  // goes red on its own, well before an actual invoice would ever need the entry it is missing, the
  // whole point being "this cannot surprise anyone again" rather than only being caught the day a
  // French invoice actually falls into the gap. Going red here is not itself a regression: it is the
  // "add the next dated entry to noteValues.lateFeeRate" reminder working as designed -- a send stays
  // sendable in the meantime via PMD's own `fallbackText` (the test right above this one), so nothing
  // user-facing breaks while this is red.
  it("FR's lateFeeRate table does not run out within the next 90 days -- add the next semi-annual ECB-derived entry before this goes red", () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const table = fr?.noteValues?.lateFeeRate ?? [];
    expect(table.length).toBeGreaterThan(0);

    const latestEntry = table.reduce((latest, t) =>
      new Date(t.validFrom).getTime() > new Date(latest.validFrom).getTime() ? t : latest,
    );
    // An open-ended latest entry (no validTo) never runs out -- nothing to warn about.
    if (!latestEntry.validTo) return;

    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);
    expect(
      new Date(latestEntry.validTo).getTime(),
      `lateFeeRate's last window ends ${latestEntry.validTo} -- within 90 days of today. Add the next ` +
        'dated entry (the ECB main refinancing rate in force on the relevant 1 January/1 July, plus ' +
        '10 points) to noteValues.lateFeeRate in data/fr.json.',
    ).toBeGreaterThan(ninetyDaysFromNow.getTime());
  });
});

// Drop-in invariant (readdir-discovery conversion) -- proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here -- the whole point of "adding a country = dropping a file" is only true if this holds.
describe('mentions/data -- every *.json on disk is actually loaded (drop-in invariant)', () => {
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

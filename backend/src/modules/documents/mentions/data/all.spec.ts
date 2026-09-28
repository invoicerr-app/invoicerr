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

  // THE CANARY (issue #519), REVISED (PR #524 review): a table that runs out is never itself a
  // problem -- PMD's own `fallbackText` (the test right above this one) keeps every send working the
  // whole time a dated entry is missing. What the canary must catch is a table left unmaintained for
  // LONGER THAN A FIX COULD TAKE, not merely "imminent expiry": the ECB's Governing Council decides
  // the rate in force on 1 January at its mid-December meeting, and the one in force on 1 July at its
  // mid-June meeting (C. com. art. L441-10 II reads whichever decision is current on those two
  // dates) -- so the real figure is ALWAYS public well before, and certainly within 21 days after,
  // the table's own `validTo`. A first version of this canary fired 90 days BEFORE expiry, which
  // meant it went red for roughly ten weeks any time the real number is genuinely not published yet
  // -- nothing a maintainer could act on, exactly the "a check nobody can fix trains everyone to
  // ignore red CI" failure mode. This one only fires once the grace period a real fix needs has
  // actually elapsed.
  //
  // `isPastMaintenanceGracePeriod` takes `now` as a parameter (rather than reading the clock itself)
  // so the exact boundary can be fixture-tested below without waiting for the calendar to reach it --
  // the canary test right after it is the only call site that hands it the REAL wall clock.
  function isPastMaintenanceGracePeriod(validTo: string, now: Date, graceDays = 21): boolean {
    const deadline = new Date(validTo);
    deadline.setDate(deadline.getDate() + graceDays);
    return now.getTime() > deadline.getTime();
  }

  it("FR's lateFeeRate table is not left unmaintained more than 21 days after its last window ends -- add the next semi-annual ECB-derived entry", () => {
    const fr = ALL_MENTIONS_FILES.find((f) => f.countryCode === 'FR');
    const table = fr?.noteValues?.lateFeeRate ?? [];
    expect(table.length).toBeGreaterThan(0);

    const latestEntry = table.reduce((latest, t) =>
      new Date(t.validFrom).getTime() > new Date(latest.validFrom).getTime() ? t : latest,
    );
    // An open-ended latest entry (no validTo) never runs out -- nothing to warn about.
    if (!latestEntry.validTo) return;

    expect(
      isPastMaintenanceGracePeriod(latestEntry.validTo, new Date()),
      `lateFeeRate's last window ended ${latestEntry.validTo} and the 21-day grace period since has ` +
        'already passed. Add the next dated entry (the ECB main refinancing rate in force on the ' +
        'relevant 1 January/1 July, plus 10 points) to noteValues.lateFeeRate in data/fr.json -- the ' +
        'ECB decision it is derived from has been public for a week or more by this point.',
    ).toBe(false);
  });

  // THE BOUNDARY, fixture-tested (never against the real shipped table, which will not sit at this
  // exact offset on any given day this suite happens to run): the exact day the canary above is
  // allowed to start firing.
  describe('isPastMaintenanceGracePeriod -- the 21-day grace period boundary', () => {
    const validTo = '2027-01-01';

    it('22 days after the window ends, the grace period has passed', () => {
      expect(isPastMaintenanceGracePeriod(validTo, new Date('2027-01-23'))).toBe(true);
    });

    it('20 days after the window ends, still inside the grace period', () => {
      expect(isPastMaintenanceGracePeriod(validTo, new Date('2027-01-21'))).toBe(false);
    });

    it('exactly on validTo, still inside the grace period', () => {
      expect(isPastMaintenanceGracePeriod(validTo, new Date(validTo))).toBe(false);
    });

    it('well before validTo, nowhere near the grace period', () => {
      expect(isPastMaintenanceGracePeriod(validTo, new Date('2026-09-28'))).toBe(false);
    });
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

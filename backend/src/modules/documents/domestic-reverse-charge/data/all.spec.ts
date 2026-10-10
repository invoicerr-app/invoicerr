/**
 * Coverage guard for the SHIPPED domestic reverse-charge catalog — same role
 * `mentions/data/all.spec.ts` and `transports/channel-policy/data/all.ts`'s own loader tests play for
 * their own files. `ALL_DOMESTIC_REVERSE_CHARGE_FILES` (`./all.ts`) now derives from
 * `defaultComposedCountryCatalog` (issue #603 step 6), not from a direct disk read of this directory,
 * so the two drop-in-invariant/runtime-drop-in proofs this file used to also carry moved with the
 * mechanism they were proving: see `countries/data/all.spec.ts`.
 */
import { assertValidDomesticReverseChargeCategory } from '../schema';
import { ALL_DOMESTIC_REVERSE_CHARGE_FILES } from './all';

describe('domestic-reverse-charge/data — the shipped DE/FR/IT/PT catalog', () => {
  it('loads exactly DE, FR, IT and PT today — not Poland (see this directory’s own all.ts header)', () => {
    expect(ALL_DOMESTIC_REVERSE_CHARGE_FILES.map((f) => f.countryCode).sort()).toEqual([
      'DE',
      'FR',
      'IT',
      'PT',
    ]);
  });

  it('every category in every shipped file has already passed the provenance gate at load time', () => {
    for (const file of ALL_DOMESTIC_REVERSE_CHARGE_FILES) {
      for (const category of file.categories) {
        expect(() => assertValidDomesticReverseChargeCategory(category, 'test')).not.toThrow();
      }
    }
  });

  it('every category carries a non-empty legalRef — no category exists with an unsourced citation', () => {
    for (const file of ALL_DOMESTIC_REVERSE_CHARGE_FILES) {
      for (const category of file.categories) {
        expect(category.legalRef.trim()).not.toBe('');
      }
    }
  });

  it('every category key is unique within its own country file', () => {
    for (const file of ALL_DOMESTIC_REVERSE_CHARGE_FILES) {
      const keys = file.categories.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('IT declares its own construction-subcontracting category sourced to DPR 633/1972 art. 17', () => {
    const it = ALL_DOMESTIC_REVERSE_CHARGE_FILES.find((f) => f.countryCode === 'IT')!;
    const category = it.categories.find((c) => c.key === 'construction-subcontracting')!;
    expect(category.legalRef).toContain('art. 17');
    expect(category.provenance.kind).toBe('legal');
  });

  it('France ships CGI art. 283-sourced categories, not the "not established" placeholder the task brief opened with', () => {
    const fr = ALL_DOMESTIC_REVERSE_CHARGE_FILES.find((f) => f.countryCode === 'FR')!;
    expect(fr.categories.length).toBeGreaterThan(0);
    for (const category of fr.categories) {
      expect(category.legalRef).toContain('CGI art. 283');
    }
  });
});

// The "drop-in invariant" and the "a country file dropped in at runtime needs no code change" proof
// that used to live here both tested THIS directory as the live discovery point. Issue #603 step 6
// moved that: `data/all.ts` no longer reads this directory at all, so dropping a file in here does
// nothing any more - the one directory where that is now true is `countries/data/`. Both proofs
// (discovery + load-time provenance gate on a freshly dropped file) move there: see
// `countries/data/all.spec.ts`.

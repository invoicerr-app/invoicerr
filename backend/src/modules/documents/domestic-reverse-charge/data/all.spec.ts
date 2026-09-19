/**
 * Coverage guard for the SHIPPED domestic reverse-charge catalog — same role
 * `mentions/data/all.spec.ts` and `transports/channel-policy/data/all.ts`'s own loader tests play for
 * their own files.
 */
import { vi } from 'vitest';

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('domestic-reverse-charge/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_DOMESTIC_REVERSE_CHARGE_FILES covers exactly the country files present in this directory', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_DOMESTIC_REVERSE_CHARGE_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});

// The literal DoD proof: drop a NEW country file into this real directory, at test time, with NO
// change to `all.ts` or this spec's own import, and show the loader picks it up — not a re-reading of
// the SAME fixed set the two `describe` blocks above already cover, but an actual file that did not
// exist when this test process started. `vi.resetModules()` + a fresh, dynamic `import('./all')` is
// required because `ALL_DOMESTIC_REVERSE_CHARGE_FILES` is computed once, at first import, exactly
// like `render-pdf.spec.ts`'s own `load()` helper needs the same reset for a module-level constant —
// see that file's own comment on why env/state read at import time needs a fresh module, not just a
// fresh call. NOT the same fix as this codebase's other converted `require('./relative')`-inside-a-
// test-body cases (hoist into the top-level `import` list): those needed the ALREADY-loaded module: this
// one specifically needs a module that has NOT been loaded yet, re-evaluated against a filesystem
// state that did not exist at the top of the file, so it stays dynamic — `vi.resetModules()` clears
// Vitest's module cache, and a bare `require('./all')` does not go through Vite's own resolver
// (confirmed to fail on a relative specifier the same way this codebase's already-converted
// `require('./relative')` cases inside a test body did) whereas dynamic `import('./all')` does, and
// resolves the `.ts` extension correctly against the just-cleared cache.
describe('domestic-reverse-charge/data — a country file dropped in at runtime needs no code change', () => {
  const fixturePath = join(__dirname, 'zz.json');

  afterEach(() => {
    if (existsSync(fixturePath)) unlinkSync(fixturePath);
    vi.resetModules();
  });

  it('discovers a brand-new zz.json with zero changes to all.ts or this test file', async () => {
    expect(existsSync(fixturePath)).toBe(false); // sanity: not already shipped

    writeFileSync(
      fixturePath,
      JSON.stringify({
        countryCode: 'ZZ',
        categories: [
          {
            key: 'fixture-category',
            label: 'Fixture category for the drop-in test',
            legalRef: 'Fixture statute art. 1',
            provenance: {
              kind: 'legal',
              sourceText: 'Fixture statutory text.',
              sourceCheckedAt: '2026-09-13',
            },
          },
        ],
      }),
      'utf-8',
    );

    vi.resetModules();
    const fresh = await import('./all.js');

    expect(fresh.ALL_DOMESTIC_REVERSE_CHARGE_FILES.map((f) => f.countryCode)).toContain('ZZ');
    const zz = fresh.ALL_DOMESTIC_REVERSE_CHARGE_FILES.find((f) => f.countryCode === 'ZZ')!;
    expect(zz.categories.map((c) => c.key)).toEqual(['fixture-category']);
  });

  it('a dropped-in file with no provenance is refused at load time, same as a shipped one would be', async () => {
    writeFileSync(
      fixturePath,
      JSON.stringify({
        countryCode: 'ZZ',
        categories: [{ key: 'unsourced', label: 'No citation at all', legalRef: 'Made up' }],
      }),
      'utf-8',
    );

    vi.resetModules();
    await expect(import('./all.js')).rejects.toThrow(/no valid provenance/);
  });
});

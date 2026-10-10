/**
 * Proves `./all.ts` reads and validates `countries/data/*.json` faithfully (issue #603 step 6: the
 * single composed loader every one of the 14 sections now goes through). Four angles:
 *
 * - deep equality against an INDEPENDENT, from-scratch `readFileSync` + `JSON.parse` of the same
 *   files, never through `./all.ts` itself - the strongest version of the "the loader doesn't alter
 *   or invent a fact" proof `countries/compose.spec.ts` held at step 1 against a second TypeScript
 *   loader fed by the SAME files; this one is independent of any loader at all;
 * - a drop-in invariant: every `*.json` actually sitting in this directory is loaded, no more, no
 *   fewer - the same discovery guarantee every one of the 14 catalogs' own (now-removed) per-country
 *   loader used to hold for its own directory, moved here because this is the one directory that
 *   discovery happens in now;
 * - a country file dropped in at runtime needs zero code change (the literal "adding a country means
 *   creating one file" proof, moved from `domestic-reverse-charge/data/all.spec.ts`, generalized to
 *   the single merged file);
 * - the load-time validation gate on a malformed section, moved from
 *   `correction-routes/data/all.spec.ts` (an invented eighth country, mocked at the `node:fs`
 *   boundary) - proving this loader still refuses to load a section with no legal provenance, and
 *   that a mismatched `countryCode` (file-level or section-level) is refused too.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ComposedCountryView, COMPOSED_COUNTRY_SECTION_KEYS } from '../compose';
import { ALL_COMPOSED_COUNTRY_FILES, loadComposedCountryFilesFrom } from './all';

const DATA_DIR = __dirname;

function independentlyParsedFiles(): Record<string, ComposedCountryView> {
  const out: Record<string, ComposedCountryView> = {};
  for (const name of readdirSync(DATA_DIR)) {
    if (!/^[a-z]{2}\.json$/.test(name)) continue;
    const cc = name.slice(0, -'.json'.length).toUpperCase();
    out[cc] = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf-8'));
  }
  return out;
}

describe('countries/data: ALL_COMPOSED_COUNTRY_FILES matches an independent read of the same files', () => {
  it('every loaded country is byte-for-byte what is actually on disk - no field added, dropped or altered', () => {
    const independent = independentlyParsedFiles();
    expect(ALL_COMPOSED_COUNTRY_FILES.length).toBe(Object.keys(independent).length);
    for (const view of ALL_COMPOSED_COUNTRY_FILES) {
      expect(view).toStrictEqual(independent[view.countryCode]);
    }
  });

  it('every section key actually present on disk is one COMPOSED_COUNTRY_SECTION_KEYS declares - no stray key silently ignored', () => {
    const independent = independentlyParsedFiles();
    for (const [cc, raw] of Object.entries(independent)) {
      const keys = Object.keys(raw).filter((k) => k !== 'countryCode');
      for (const key of keys) {
        expect(COMPOSED_COUNTRY_SECTION_KEYS as readonly string[]).toContain(key);
      }
      void cc;
    }
  });
});

describe('countries/data: every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_COMPOSED_COUNTRY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const onDisk = readdirSync(DATA_DIR)
      .filter((name) => /^[a-z]{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_COMPOSED_COUNTRY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});

// The literal "adding a country means creating ONE file" proof: drop a new file into an isolated
// temporary directory (never the real, shipped one, which other specs read concurrently) and show
// `loadComposedCountryFilesFrom` picks it up, with no change to `all.ts` or this spec's own import.
describe('countries/data: a country file dropped in at runtime needs no code change', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-all-spec-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers a brand-new zz.json with zero changes to all.ts or this test file', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: {
          countryCode: 'ZZ',
          kind: 'VAT',
          provenance: { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-02' },
        },
      }),
      'utf-8',
    );

    const files = loadComposedCountryFilesFrom(tmpDir);

    expect(files.map((f) => f.countryCode)).toEqual(['ZZ']);
    const zz = files.find((f) => f.countryCode === 'ZZ')!;
    expect(zz.taxSystem.kind).toBe('VAT');
    expect(zz.policy).toBeUndefined(); // no other section present - never defaulted
  });

  it('a dropped-in file whose taxSystem section has no provenance is refused at load time, same as a shipped one would be', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: { countryCode: 'ZZ', kind: 'VAT' },
      }),
      'utf-8',
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/no valid provenance/);
  });

  it('a dropped-in file whose top-level countryCode does not match its own filename is refused at load time', () => {
    writeFileSync(join(tmpDir, 'zz.json'), JSON.stringify({ countryCode: 'YY' }), 'utf-8');

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/declares countryCode "YY", expected "ZZ"/);
  });

  it('a dropped-in file whose section countryCode disagrees with its own file-level countryCode is refused at load time', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: {
          countryCode: 'YY',
          kind: 'VAT',
          provenance: { kind: 'legal', sourceText: 'Fixture.', sourceCheckedAt: '2026-10-02' },
        },
      }),
      'utf-8',
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"taxSystem.countryCode" \("YY"\) must match/);
  });
});

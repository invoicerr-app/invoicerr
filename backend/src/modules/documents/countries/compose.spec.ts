/**
 * Proves `compose.ts` only REGROUPS the 14 existing catalogs, never alters or invents a fact — the
 * one property step 1 of issue #603 exists to establish. Every assertion here reads straight from
 * each catalog's own `data/all.ts` (the "existing loader" the brief asks this to match), never from
 * a second, hand-copied fixture that could quietly drift from the real files.
 *
 * Two independent angles, deliberately both present:
 * - deep equality, per country and per section, against the matching entry in the existing loader's
 *   own array (catches a wrong value, or a copy-paste index swap between two similarly-shaped
 *   catalogs — e.g. vat-rates vs. vat-currency);
 * - an explicit coverage matrix, pinned by hand below, so a catalog silently gaining or losing a
 *   country shows up here as a red test instead of an unnoticed diff (the brief's own "a test lists
 *   which countries have which sections, so a missing or extra section is visible").
 */
import { ALL_COUNTRY_POLICY_FILES } from '../country-policy/data/all';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '../country-identifiers/data/all';
import { ALL_CORRECTION_ROUTES_FILES } from '../correction-routes/data/all';
import { ALL_VAT_RATE_FILES } from '../vat-rates/data/all';
import { ALL_TAX_SYSTEM_FILES } from '../tax/tax-systems/data/all';
import { ALL_VAT_CURRENCY_FILES } from '../vat-currency/data/all';
import { ALL_CHANNEL_POLICY_FILES } from '../transports/channel-policy/data/all';
import { ALL_RETENTION_FILES } from '../archive/retention/data/all';
import { ALL_MENTIONS_FILES } from '../mentions/data/all';
import { ALL_REPORTING_OBLIGATION_FILES } from '../reporting/data/all';
import { ALL_DOMESTIC_REVERSE_CHARGE_FILES } from '../domestic-reverse-charge/data/all';
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from '../country-fields/data/all';
import { ALL_CONTENT_REQUIREMENT_FILES } from '../content-requirements/data/all';
import { ALL_B2G_ROUTING_FILES } from '../b2g-routing/data/all';
import { ALL_COMPOSED_COUNTRIES, ComposedCountryView, COMPOSED_COUNTRY_SECTION_KEYS } from './compose';

/** One row per section: its key in `ComposedCountryView`, and the existing loader's own array that
 *  is the single source of truth for that section — the SAME arrays `compose.ts` itself reads, so
 *  this test exercises the real loaders, never a duplicate. */
const SECTIONS: {
  key: keyof Omit<ComposedCountryView, 'countryCode'>;
  files: ReadonlyArray<{ countryCode: string }>;
}[] = [
  { key: 'policy', files: ALL_COUNTRY_POLICY_FILES },
  { key: 'identifiers', files: ALL_COUNTRY_IDENTIFIER_FILES },
  { key: 'correctionRoutes', files: ALL_CORRECTION_ROUTES_FILES },
  { key: 'vatRates', files: ALL_VAT_RATE_FILES },
  { key: 'taxSystem', files: ALL_TAX_SYSTEM_FILES },
  { key: 'vatCurrency', files: ALL_VAT_CURRENCY_FILES },
  { key: 'channelPolicy', files: ALL_CHANNEL_POLICY_FILES },
  { key: 'retention', files: ALL_RETENTION_FILES },
  { key: 'mentions', files: ALL_MENTIONS_FILES },
  { key: 'reporting', files: ALL_REPORTING_OBLIGATION_FILES },
  { key: 'domesticReverseCharge', files: ALL_DOMESTIC_REVERSE_CHARGE_FILES },
  { key: 'countryFields', files: ALL_COUNTRY_FIELD_OVERLAY_FILES },
  { key: 'contentRequirements', files: ALL_CONTENT_REQUIREMENT_FILES },
  { key: 'b2gRouting', files: ALL_B2G_ROUTING_FILES },
];

function composedFor(countryCode: string): ComposedCountryView {
  const view = ALL_COMPOSED_COUNTRIES.find((v) => v.countryCode === countryCode);
  if (!view) throw new Error(`No composed view for "${countryCode}" — composeCountry/discovery is broken.`);
  return view;
}

describe('countries/compose — every SECTION this file declares is the canonical list (keeps SECTIONS above honest)', () => {
  it('covers exactly the same keys as COMPOSED_COUNTRY_SECTION_KEYS, same order', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(COMPOSED_COUNTRY_SECTION_KEYS);
  });
});

describe('countries/compose — deep equality against every existing loader, per country and per section', () => {
  it.each(
    SECTIONS,
  )('$key: every file the existing loader returns is reproduced bit for bit in the composed view', ({
    key,
    files,
  }) => {
    expect(files.length).toBeGreaterThan(0); // a section with nothing shipped would pass vacuously
    for (const file of files) {
      expect(composedFor(file.countryCode)[key]).toStrictEqual(file);
    }
  });

  it('no composed view carries a section its matching source catalog does not also carry (no stray/extra section)', () => {
    for (const { key, files } of SECTIONS) {
      const codesInSource = new Set(files.map((f) => f.countryCode));
      for (const view of ALL_COMPOSED_COUNTRIES) {
        expect(view[key] !== undefined).toBe(codesInSource.has(view.countryCode));
      }
    }
  });

  it("composes exactly the union of every section catalog's own countries, no more, no fewer", () => {
    const expectedCodes = new Set<string>();
    for (const { files } of SECTIONS) for (const f of files) expectedCodes.add(f.countryCode);
    expect(ALL_COMPOSED_COUNTRIES.map((v) => v.countryCode).sort()).toEqual(Array.from(expectedCodes).sort());
  });
});

// Pinned by hand on purpose (2026-10-01, issue #603 step 1) — this is the test the brief calls "a
// test lists which countries have which sections, so a missing or extra section is visible". A
// catalog that ships a new country's file, or drops one, must change this table in the SAME pull
// request as the data change — a silent diff here is exactly the failure mode this test exists to
// catch. Verified against the real `data/` directories on disk at the time this PR was written, not
// copied from `AUDIT_DONNEES_PAYS.md` (whose own §2 table had already gone stale on `countryFields`
// and `retention` by the time this PR branched from dev).
describe('countries/compose — section coverage per country (pinned on purpose, see comment above)', () => {
  it('matches the shipped catalogs file by file, country by country', () => {
    const matrix: Record<string, (keyof Omit<ComposedCountryView, 'countryCode'>)[]> = {};
    for (const view of ALL_COMPOSED_COUNTRIES) {
      matrix[view.countryCode] = COMPOSED_COUNTRY_SECTION_KEYS.filter((key) => view[key] !== undefined);
    }

    expect(matrix).toEqual({
      DE: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
      DZ: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'channelPolicy',
        'retention',
      ],
      FR: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'mentions',
        'reporting',
        'domesticReverseCharge',
        'countryFields',
        'contentRequirements',
        'b2gRouting',
      ],
      IT: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
      PL: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'countryFields',
        'b2gRouting',
      ],
      PT: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'reporting',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
    });
  });

  it('every one of the six shipped countries has at least a policy section (the minimum to be "supported" at all)', () => {
    for (const code of ['DE', 'DZ', 'FR', 'IT', 'PL', 'PT']) {
      expect(composedFor(code).policy).toBeDefined();
    }
  });
});

// Drop-in invariant: proves `discoverComposedCountryCodes` really is a union over every section's
// OWN discovery, not a fixed list — the same invariant each sibling catalog's own
// `data/all.spec.ts` already pins for its single directory, extended here across all 14 at once.
describe('countries/compose — every *.json on disk, across all 14 catalogs, is represented (drop-in invariant)', () => {
  it('ALL_COMPOSED_COUNTRIES covers exactly the countries present in at least one catalog directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const { join } = require('node:path');
    const CATALOG_DATA_DIRS = [
      '../country-policy/data',
      '../country-identifiers/data',
      '../correction-routes/data',
      '../vat-rates/data',
      '../tax/tax-systems/data',
      '../vat-currency/data',
      '../transports/channel-policy/data',
      '../archive/retention/data',
      '../mentions/data',
      '../reporting/data',
      '../domestic-reverse-charge/data',
      '../country-fields/data',
      '../content-requirements/data',
      '../b2g-routing/data',
    ];
    const onDisk = new Set<string>();
    for (const dir of CATALOG_DATA_DIRS) {
      const absolute = join(__dirname, dir);
      for (const name of readdirSync(absolute)) {
        if (/^[a-z]{2}\.json$/.test(name)) onDisk.add(name.replace(/\.json$/, '').toUpperCase());
      }
    }
    const composed = new Set(ALL_COMPOSED_COUNTRIES.map((v) => v.countryCode));
    expect(Array.from(composed).sort()).toEqual(Array.from(onDisk).sort());
  });
});

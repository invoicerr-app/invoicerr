/**
 * The only aggregator — adding a country to the VAT rate catalog means adding `data/xx.json` and
 * NOTHING else, never an engine or field change (see descriptors/company-view.ts, the one thing
 * that actually reads this catalog).
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * the same deliberate choice country-policy/data/all.ts already made, and the removed compliance
 * engine's own tax-rates/data/all.ts before it (recoverable at git tag
 * `avant-refonte-documents:backend/src/compliance/tax-rates/data/all.ts`): adding or editing a rate
 * never needs a TypeScript change or a rebuild step beyond what any other data file in this repo
 * already needs. `nest-cli.json`'s `**\/*.json` asset rule copies these next to the compiled code in
 * `dist/src`.
 *
 * The country list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory
 * with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code
 * plus `.json`, which is a country file and nothing else (it excludes this `all.ts`, `all.spec.ts`,
 * and every per-country `xx.spec.ts` sitting in the same directory, none of which are `.json`).
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading — deterministic,
 * reproducible, independent of the OS or filesystem.
 *
 * Every rate is validated HERE, at load time — see schema.ts's `assertValidVatRateProvenance` — so a
 * malformed or unsourced rate fails as soon as this module is imported (at boot), never silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryVatRatesFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryVatRatesFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/vat-rates/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const rate of parsed.rates) {
    assertValidVatRateProvenance(rate, `documents/vat-rates/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's VAT rate catalog, one file per country — see the module docstring. A
 *  country with NO entry here has no known catalog at all, which is exactly the "no known list, show
 *  an honest escape hatch, never a dead field" case descriptors/company-view.ts handles. */
export const ALL_VAT_RATE_FILES: CountryVatRatesFile[] = discoverCountryCodes().map(loadCountryFile);

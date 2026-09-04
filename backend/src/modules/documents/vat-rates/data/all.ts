/**
 * The only aggregator — adding a country to the VAT rate catalog means adding `data/xx.json` plus
 * one line here, never an engine or field change (see descriptors/company-view.ts, the one thing
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
 * Every rate is validated HERE, at load time — see schema.ts's `assertValidVatRateProvenance` — so a
 * malformed or unsourced rate fails as soon as this module is imported (at boot), never silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

// Only France today — this task's own scope ("La France, et elle seule"). Adding a second country's
// catalog is exactly one entry here plus its own data/xx.json, the same shape
// country-policy/data/all.ts's own COUNTRY_FILES already has.
const COUNTRY_FILES = ['fr', 'be', 'nl', 'at', 'ee', 'gr', 'cy', 'lt', 'lv', 'lu'] as const;

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
export const ALL_VAT_RATE_FILES: CountryVatRatesFile[] = COUNTRY_FILES.map(loadCountryFile);

/**
 * The only aggregator — same rule as `profiles/data/all.ts`: adding a country to the VAT rate
 * catalog means adding `data/xx.json` plus one line here, never an engine or seed change.
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * deliberately, so this is a real "file that gets read" in the sense the feature was asked for, and
 * so adding/editing a rate never needs a TypeScript change or a rebuild step beyond what any other
 * data file in this repo already needs. `nest-cli.json`'s `**\/*.json` asset rule copies these next
 * to the compiled seed code in `dist/src`, exactly like the plugin form JSON files already do
 * (`src/plugins/index.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CountryVatRatesFile } from '../schema';

const COUNTRY_FILES = ['fr', 'it', 'pl', 'mx'] as const;

function loadCountryFile(code: string): CountryVatRatesFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryVatRatesFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `tax-rates/data/${code}.json declares countryCode "${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  return parsed;
}

/** Every wired jurisdiction's VAT rate catalog, one file per country — see the module docstring. */
export const ALL_VAT_RATE_FILES: CountryVatRatesFile[] = COUNTRY_FILES.map(loadCountryFile);

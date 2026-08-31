/**
 * The only aggregator — same shape as `vat-rates/data/all.ts`/`country-identifiers/data/all.ts`:
 * adding a country's tax-system fact means adding `data/xx.json` plus one line here, never an engine
 * change. Files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * the same deliberate choice every other data/all.ts loader in this module already makes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidTaxSystemProvenance, CountryTaxSystemFact } from '../schema';

const COUNTRY_FILES = ['fr', 'us', 'it', 'sa', 'ae', 'in', 'qa'] as const;

function loadCountryFile(code: string): CountryTaxSystemFact {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryTaxSystemFact;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/tax/tax-systems/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  assertValidTaxSystemProvenance(parsed, `documents/tax/tax-systems/data/${code}.json`);
  return parsed;
}

/** Every wired jurisdiction's tax-system fact, one file per country. A country with NO entry here has
 *  no known tax-system profile at all — `registry.ts#resolve` returns `undefined` for it, which is
 *  exactly what makes an unknown destination (e.g. Germany, in this branch, for the OSS gate) a
 *  NAMED BLOCK rather than a guessed rate — see `../resolve-invoice-tax.ts`'s own header. */
export const ALL_TAX_SYSTEM_FILES: CountryTaxSystemFact[] = COUNTRY_FILES.map(loadCountryFile);

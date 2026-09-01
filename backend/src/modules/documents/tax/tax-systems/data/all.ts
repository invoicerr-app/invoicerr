/**
 * The only aggregator — same shape as `vat-rates/data/all.ts`/`country-identifiers/data/all.ts`:
 * adding a country's tax-system fact means adding `data/xx.json` plus one line here, never an engine
 * change. Files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * the same deliberate choice every other data/all.ts loader in this module already makes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidTaxSystemProvenance, CountryTaxSystemFact } from '../schema';

const COUNTRY_FILES = [
  'fr',
  'us',
  'it',
  'sa',
  'ae',
  'in',
  'qa',
  // The 26 other EU member states — root TODO item 16's own OSS follow-up ("sourcer les tables de
  // taux par pays de destination"), standard VAT rate only, read from the European Commission's
  // TEDB (DG TAXUD) — see each file's own `provenance`/`notes` for the exact HTTP request and
  // response quoted. Alphabetical, not the OSS-gate's own historical example order.
  'at',
  'be',
  'bg',
  'hr',
  'cy',
  'cz',
  'dk',
  'ee',
  'gr',
  'es',
  'fi',
  'de',
  'hu',
  'ie',
  'lv',
  'lt',
  'lu',
  'mt',
  'nl',
  'pl',
  'pt',
  'ro',
  'sk',
  'si',
  'se',
] as const;

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
 *  exactly what makes an unknown destination a NAMED BLOCK rather than a guessed rate — see
 *  `../resolve-invoice-tax.ts`'s own header, "OSS with no destination rate table". Germany used to be
 *  that example (the OSS gate's own historical error message names DE); it no longer blocks — see
 *  `de.json` — but the mechanism itself still blocks any EU member state whose file is missing here. */
export const ALL_TAX_SYSTEM_FILES: CountryTaxSystemFact[] = COUNTRY_FILES.map(loadCountryFile);

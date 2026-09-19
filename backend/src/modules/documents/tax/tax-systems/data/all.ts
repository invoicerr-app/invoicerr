/**
 * The only aggregator — same shape as `vat-rates/data/all.ts`/`country-identifiers/data/all.ts`:
 * adding a country's tax-system fact means adding `data/xx.json` and NOTHING else, never an engine
 * change. Files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * the same deliberate choice every other data/all.ts loader in this module already makes.
 *
 * The country list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory
 * with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code
 * plus `.json`, which is a country file and nothing else (it excludes this `all.ts` and
 * `all.spec.ts`, neither of which is `.json`). `readdirSync` makes no ordering promise, so the codes
 * are sorted before loading — deterministic, reproducible, independent of the OS or filesystem. What
 * shipped here — the 7 non-EU jurisdictions plus the full EU-27 (the OSS follow-up,
 * "sourcer les tables de taux par pays de destination", standard VAT rate only, read from the
 * European Commission's TEDB / DG TAXUD — see each file's own `provenance`/`notes` for the exact HTTP
 * request and response quoted) — is now a fact about what's on disk, not a list to keep in sync.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidTaxSystemProvenance, CountryTaxSystemFact } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

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
export const ALL_TAX_SYSTEM_FILES: CountryTaxSystemFact[] = discoverCountryCodes().map(loadCountryFile);

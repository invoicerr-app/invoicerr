/**
 * The only aggregator — adding a country's identifier requirements means adding `data/xx.json` and
 * NOTHING else, never an engine or seed change. Same shape as country-policy/data/all.ts, discovery
 * mechanism included.
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * deliberately, so adding or editing a fact never needs a TypeScript change or a rebuild step, the
 * same choice country-policy/data/all.ts already made for the same reason. `nest-cli.json`'s
 * `**\/*.json` asset rule copies these next to the compiled seed code in `dist/src`.
 *
 * The country list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory
 * with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code
 * plus `.json`, which is a country file and nothing else (it excludes this `all.ts`, `all.spec.ts`,
 * and every per-country `xx.spec.ts` sitting in the same directory, none of which are `.json`).
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading — deterministic,
 * reproducible, independent of the OS or filesystem.
 *
 * Every fact is validated HERE, at load time — see schema.ts's `assertValidProvenance` — so a
 * malformed or unsourced fact fails as soon as this module is imported (at boot, or when the seed
 * script runs), never silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertPatternIsExplainable,
  assertValidProvenance,
  CountryIdentifierRequirementsFile,
} from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryIdentifierRequirementsFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryIdentifierRequirementsFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/country-identifiers/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const fact of parsed.schemes) {
    assertValidProvenance(fact, `documents/country-identifiers/data/${code}.json`);
    assertPatternIsExplainable(fact, `documents/country-identifiers/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's identifier requirements, one file per country — see the module
 *  docstring. A country with NO entry here has no requirements at all — see
 *  country-identifiers.ts's resolveRequiredIdentifiers for how that state is surfaced. */
export const ALL_COUNTRY_IDENTIFIER_FILES: CountryIdentifierRequirementsFile[] =
  discoverCountryCodes().map(loadCountryFile);

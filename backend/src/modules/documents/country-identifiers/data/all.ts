/**
 * The only aggregator — adding a country's identifier requirements means adding `data/xx.json` plus
 * one line here, never an engine or seed change. Same shape as country-policy/data/all.ts.
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * deliberately, so adding or editing a fact never needs a TypeScript change or a rebuild step, the
 * same choice country-policy/data/all.ts already made for the same reason. `nest-cli.json`'s
 * `**\/*.json` asset rule copies these next to the compiled seed code in `dist/src`.
 *
 * Every fact is validated HERE, at load time — see schema.ts's `assertValidProvenance` — so a
 * malformed or unsourced fact fails as soon as this module is imported (at boot, or when the seed
 * script runs), never silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

const COUNTRY_FILES = ['fr', 'us', 'de', 'gb', 'be', 'nl', 'at', 'ee', 'gr', 'cy', 'lt', 'lv', 'lu'] as const;

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
  }
  return parsed;
}

/** Every wired jurisdiction's identifier requirements, one file per country — see the module
 *  docstring. A country with NO entry here has no requirements at all — see
 *  country-identifiers.ts's resolveRequiredIdentifiers for how that state is surfaced. */
export const ALL_COUNTRY_IDENTIFIER_FILES: CountryIdentifierRequirementsFile[] =
  COUNTRY_FILES.map(loadCountryFile);

/**
 * The only aggregator — adding a country's reporting obligation means adding `data/xx.json` and
 * NOTHING else, mirroring `transports/channel-policy/data/all.ts`'s own header verbatim on why this
 * reads the file with `fs.readFileSync` rather than `import`ing it as a TS module: editing a fact is
 * then a plain data change, never a TypeScript one.
 *
 * The country list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory
 * with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code
 * plus `.json`, which is a country file and nothing else (it excludes this `all.ts`, not `.json`).
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading — deterministic,
 * reproducible, independent of the OS or filesystem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidReportingObligationFact, CountryReportingObligationFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryReportingObligationFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryReportingObligationFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/reporting/data/${code}.json declares countryCode "${parsed.countryCode}", expected ` +
        `"${code.toUpperCase()}"`,
    );
  }
  for (const fact of parsed.facts) {
    assertValidReportingObligationFact(fact, `documents/reporting/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's reporting obligation, one file per country — see the module docstring.
 *  A country with no entry here has no obligation at all — the trigger (`report-on-send.ts`) enqueues
 *  nothing for it, never a guess in either direction. */
export const ALL_REPORTING_OBLIGATION_FILES: CountryReportingObligationFile[] =
  discoverCountryCodes().map(loadCountryFile);

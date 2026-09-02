/**
 * The only aggregator — adding a country's reporting obligation means adding `data/xx.json` plus one
 * line here, mirroring `transports/channel-policy/data/all.ts`'s own header verbatim on why this
 * reads the file with `fs.readFileSync` rather than `import`ing it as a TS module: editing a fact is
 * then a plain data change, never a TypeScript one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidReportingObligationFact, CountryReportingObligationFile } from '../schema';

const COUNTRY_FILES = ['hu', 'gr'] as const;

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
  COUNTRY_FILES.map(loadCountryFile);

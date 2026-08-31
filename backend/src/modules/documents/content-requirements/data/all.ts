/**
 * The only aggregator — adding a country's content requirement means adding `data/xx.json` plus one
 * line here, never an engine change. Same shape as `../../mentions/data/all.ts` and
 * `../../transports/channel-policy/data/all.ts` (same reason too: `fs.readFileSync` rather than
 * `import`, so editing a fact — or its citation — is a plain data change needing no rebuild step
 * beyond what any other data file in this repo already needs, `nest-cli.json`'s own `**\/*.json`
 * asset rule).
 *
 * Every fact is validated HERE, at load time (`assertValidContentRequirementFact` — schema.ts), so a
 * fact with no citation or no start date fails as soon as this module is imported (at boot), never
 * silently — the same discipline every sibling `data/all.ts` in `documents/` already holds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidContentRequirementFact, CountryContentRequirementsFile } from '../schema';

// Only France today — the one country a real superpdp conformity poll actually cited BT-23 for
// (`../../transports/pdp/pdp.live.spec.ts`). Adding a second country/field is exactly one entry here
// plus its own data/xx.json.
const COUNTRY_FILES = ['fr'] as const;

function loadCountryFile(code: string): CountryContentRequirementsFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryContentRequirementsFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/content-requirements/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const fact of parsed.facts ?? []) {
    assertValidContentRequirementFact(fact, `documents/content-requirements/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's content requirements, one file per country — see the module docstring.
 *  A country with no entry here has no requirement at all: `formats/semantic/business-process.ts`'s
 *  own `resolveFrenchBusinessProcessCode` treats that exactly like `activeContentRequirementFor`
 *  returning undefined — no BT-23 imposed, every existing non-FR CII/UBL test unaffected. */
export const ALL_CONTENT_REQUIREMENT_FILES: CountryContentRequirementsFile[] =
  COUNTRY_FILES.map(loadCountryFile);

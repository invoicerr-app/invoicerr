/**
 * The only aggregator — adding a country's retention durations means adding `data/xx.json` plus one
 * line here, mirroring `documents/mentions/data/all.ts`'s own header verbatim on why this reads the
 * file with `fs.readFileSync` rather than `import`ing it as a TS module: editing a duration (or its
 * citation) is then a plain data change, never a TypeScript one, and needs no rebuild step beyond
 * what any other data file in this repo already needs (`nest-cli.json`'s own `**\/*.json` asset rule
 * copies these next to the compiled code in `dist/src`).
 *
 * Every rule is validated HERE, at load time (`assertValidRetentionRule` — schema.ts), so a rule with
 * no `legalRef` (or a non-positive `years`) fails as soon as this module is imported (at boot), never
 * silently — the same "a rule without a citation does not load" discipline `mentions/data/all.ts`
 * already holds for a mandatory mention.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidRetentionRule, CountryRetentionFile } from '../schema';

// Only France today — the country this task's own repère (`avant-refonte-documents`) sourced two
// SIMULTANEOUS, cited durations for (see `data/fr.json`'s own header). Adding a second country's
// retention rule is exactly one entry here plus its own data/xx.json, the same shape
// `mentions/data/all.ts`'s own `COUNTRY_FILES` already has. A country with NO entry here is not an
// oversight to fix by guessing a duration — see `compute-retention.ts`'s own header for why "no rule
// declared" is itself the correct, honest answer for such a country.
const COUNTRY_FILES = ['fr'] as const;

function loadCountryFile(code: string): CountryRetentionFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryRetentionFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/archive/retention/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const rule of parsed.rules ?? []) {
    assertValidRetentionRule(rule, `documents/archive/retention/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's retention durations, one file per country — see the module docstring. A
 *  country with no entry here has NO declared rule at all: `compute-retention.ts#computeRetention`
 *  returns a null `retentionUntil` and an honest `retentionBasis` for it, never an invented duration. */
export const ALL_RETENTION_FILES: CountryRetentionFile[] = COUNTRY_FILES.map(loadCountryFile);

/**
 * The only aggregator — adding a country's retention durations means adding `data/xx.json` and NOTHING
 * else, mirroring `documents/mentions/data/all.ts`'s own header verbatim on why this reads the file
 * with `fs.readFileSync` rather than `import`ing it as a TS module: editing a duration (or its
 * citation) is then a plain data change, never a TypeScript one, and needs no rebuild step beyond
 * what any other data file in this repo already needs (`nest-cli.json`'s own `**\/*.json` asset rule
 * copies these next to the compiled code in `dist/src`).
 *
 * Every rule is validated HERE, at load time (`assertValidRetentionRule` — schema.ts), so a rule with
 * no `legalRef` (or a non-positive `years`, or a missing/invalid `origin`) fails as soon as this module
 * is imported (at boot), never silently — the same "a rule without a citation does not load" discipline
 * `mentions/data/all.ts` already holds for a mandatory mention.
 *
 * The list is DISCOVERED, not hand-maintained (fixed 2026-09-13 — this file used to hard-code a
 * `COUNTRY_FILES = ['fr']` array whose own comment claimed this was "the same shape
 * `mentions/data/all.ts`'s own `COUNTRY_FILES` already has": that claim went stale the day
 * `mentions/data/all.ts` moved to auto-discovery and was never corrected here, so dropping a second
 * country's `data/xx.json` into this directory did NOTHING until a maintainer also remembered to add
 * its code to a list — silently, since nothing failed, a rule for a country nobody wired ever loaded
 * either). `discoverCountryCodes()` reads this directory with `readdirSync` and keeps only names
 * matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code plus `.json`, which is a country file and
 * nothing else (it excludes this `all.ts` and `all.spec.ts`, neither of which is `.json`). Adding a
 * second country's retention rules is exactly its own `data/xx.json`, no line to add here —
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading regardless of how
 * many ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidRetentionRule, CountryRetentionFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

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
export const ALL_RETENTION_FILES: CountryRetentionFile[] = discoverCountryCodes().map(loadCountryFile);

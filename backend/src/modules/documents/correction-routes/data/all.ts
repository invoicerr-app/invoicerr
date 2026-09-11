/**
 * The only aggregator — adding a country's correction-routes rule means adding `data/xx.json` and
 * NOTHING else, mirroring `b2g-routing/data/all.ts`'s own header verbatim on why this reads the file
 * with `fs.readFileSync` rather than `import`ing it as a TS module: editing a rule is then a plain
 * data change, never a TypeScript one.
 *
 * Ships exactly the seven pivot countries `documentation/internal/CORRECTION-ROUTES.yaml` itself covers
 * (meta.covered: FR/IT/PL/DE/ES/MX/US) — plus every later
 * addition, each a plain `data/xx.json` drop. A country with no entry here has NO correction-routes
 * rule at all: `correction-routes.ts`'s own read side surfaces that as an HONEST, NAMED refusal ("no
 * correction-routes rule declared for XX"), never a silent "assume CREDIT_NOTE like everyone else"
 * fallback — the exact temptation the YAML's own header warns against ("Sept profils sur huit portent
 * aujourd'hui la même valeur CREDIT_NOTE, et la recherche documentaire en contredit déjà plusieurs").
 *
 * The country list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory
 * with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code
 * plus `.json`, which is a country file and nothing else (it excludes this `all.ts`, `all.spec.ts`,
 * and every per-country `xx.spec.ts` sitting in the same directory, none of which are `.json`).
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading — deterministic,
 * reproducible, independent of the OS or filesystem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CountryCorrectionRoutesFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/** Exported ONLY so `all.spec.ts` can prove the gate against an INVENTED eighth country (a JSON blob
 *  that never ships, mocked at the `node:fs` boundary) without needing a real, checked-in file that
 *  deliberately breaks the rule it exists to enforce. Every REAL caller uses `ALL_CORRECTION_ROUTES_FILES`
 *  below, never this directly. */
export function loadCountryFile(code: string): CountryCorrectionRoutesFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryCorrectionRoutesFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/correction-routes/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const route of parsed.routes) {
    assertValidCorrectionRouteFact(route, `documents/correction-routes/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's correction-routes file, one file per country — see the module docstring. */
export const ALL_CORRECTION_ROUTES_FILES: CountryCorrectionRoutesFile[] =
  discoverCountryCodes().map(loadCountryFile);

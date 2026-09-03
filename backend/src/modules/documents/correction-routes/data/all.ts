/**
 * The only aggregator — adding a country's correction-routes rule means adding `data/xx.json` plus one
 * line here, mirroring `b2g-routing/data/all.ts`'s own header verbatim on why this reads the file with
 * `fs.readFileSync` rather than `import`ing it as a TS module: editing a rule is then a plain data
 * change, never a TypeScript one.
 *
 * Ships exactly the seven pivot countries `docs/compliance/CORRECTION-ROUTES.yaml` itself covers
 * (meta.covered: FR/IT/PL/DE/ES/MX/US) — TODO_CORRECTION.md C1's own explicit scope. A country with no
 * entry here has NO correction-routes rule at all: `correction-routes.ts`'s own read side surfaces
 * that as an HONEST, NAMED refusal ("no correction-routes rule declared for XX"), never a silent
 * "assume CREDIT_NOTE like everyone else" fallback — the exact temptation the YAML's own header warns
 * against ("Sept profils sur huit portent aujourd'hui la même valeur CREDIT_NOTE, et la recherche
 * documentaire en contredit déjà plusieurs").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CountryCorrectionRoutesFile } from '../schema';

const COUNTRY_FILES = ['fr', 'it', 'pl', 'de', 'es', 'mx', 'us'] as const;

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
export const ALL_CORRECTION_ROUTES_FILES: CountryCorrectionRoutesFile[] = COUNTRY_FILES.map(loadCountryFile);

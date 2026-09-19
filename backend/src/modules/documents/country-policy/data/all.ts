/**
 * The only aggregator — adding a country to the document-action policy means adding `data/xx.json`
 * and NOTHING else: no array to edit, no engine or seed change. Removing a country is the same in
 * reverse — delete the file and it stops loading, no dangling entry to clean up.
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * deliberately, so adding or editing a rule never needs a TypeScript change or a rebuild step beyond
 * what any other data file in this repo already needs (the same choice the — now removed — VAT rate
 * catalog made for the exact same reason; see its data/all.ts in git history at
 * `avant-refonte-documents:backend/src/compliance/tax-rates/data/all.ts`). `nest-cli.json`'s
 * `**\/*.json` asset rule copies these next to the compiled seed code in `dist/src`.
 *
 * The country list itself is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this
 * directory with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase
 * two-letter code plus `.json`, which is exactly a country file and nothing else (it excludes this
 * `all.ts`, `all.spec.ts`, and every per-country `xx.spec.ts` in the same directory, none of which
 * are `.json`). `readdirSync` makes no ordering promise — it hands back whatever the filesystem
 * happens to return — so the codes are sorted before loading, for a deterministic, reproducible
 * result independent of the OS or filesystem (the same determinism `registry.ts#countries()` already
 * re-derives for itself downstream).
 *
 * Every rule is validated HERE, at load time — see schema.ts's `assertValidProvenance` — so a
 * malformed or unsourced rule fails as soon as this module is imported (at boot, or when the seed
 * script runs), never silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryDocumentPolicyFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryDocumentPolicyFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/country-policy/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  if (!Array.isArray(parsed.documentTypes) || parsed.documentTypes.length === 0) {
    throw new Error(
      `documents/country-policy/data/${code}.json must declare a non-empty "documentTypes" array — ` +
        "see schema.ts's own comment on that field.",
    );
  }
  for (const rule of parsed.rules) {
    assertValidProvenance(rule, `documents/country-policy/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's document-action policy, one file per country — see the module
 *  docstring. A country with NO entry here has no rules at all, which is precisely the "blocks
 *  everything" state country-policy.ts's evaluateCountryPolicy() enforces. */
export const ALL_COUNTRY_POLICY_FILES: CountryDocumentPolicyFile[] =
  discoverCountryCodes().map(loadCountryFile);

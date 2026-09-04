/**
 * The only aggregator — adding a country to the document-action policy means adding `data/xx.json`
 * plus one line here, never an engine or seed change.
 *
 * The files are genuinely READ (`fs.readFileSync` + `JSON.parse`), not `import`ed as TS modules —
 * deliberately, so adding or editing a rule never needs a TypeScript change or a rebuild step beyond
 * what any other data file in this repo already needs (the same choice the — now removed — VAT rate
 * catalog made for the exact same reason; see its data/all.ts in git history at
 * `avant-refonte-documents:backend/src/compliance/tax-rates/data/all.ts`). `nest-cli.json`'s
 * `**\/*.json` asset rule copies these next to the compiled seed code in `dist/src`.
 *
 * Every rule is validated HERE, at load time — see schema.ts's `assertValidProvenance` — so a
 * malformed or unsourced rule fails as soon as this module is imported (at boot, or when the seed
 * script runs), never silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

const COUNTRY_FILES = ['fr', 'us', 'hu', 'de', 'it', 'pl', 'es', 'mx', 'be', 'nl', 'at', 'ee', 'gr', 'cy', 'lt', 'lv', 'lu', 'mt', 'se', 'dk', 'fi', 'ie'] as const;

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
export const ALL_COUNTRY_POLICY_FILES: CountryDocumentPolicyFile[] = COUNTRY_FILES.map(loadCountryFile);

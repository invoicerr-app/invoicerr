/**
 * The only aggregator — adding a country's mandatory mentions means adding `data/xx.json` plus one
 * line here, mirroring `transports/channel-policy/data/all.ts`'s own header verbatim on why this
 * reads the file with `fs.readFileSync` rather than `import`ing it as a TS module: editing a mention
 * (or a rate in its value table) is then a plain data change, never a TypeScript one, and needs no
 * rebuild step beyond what any other data file in this repo already needs (`nest-cli.json`'s own
 * `**\/*.json` asset rule copies these next to the compiled code in `dist/src`).
 *
 * Every rule is validated HERE, at load time (`assertValidMentionRule` — schema.ts), so a mention
 * with no `legalRef` fails as soon as this module is imported (at boot), never silently — the same
 * "a mandate without a citation does not load" discipline
 * `transports/channel-policy/data/all.ts` already holds for a channel mandate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidMentionRule, CountryMentionsFile } from '../schema';

// Only France today — this task's own scope (the repère's only sourced country for this concern).
// Adding a second country's mentions is exactly one entry here plus its own data/xx.json, the same
// shape `transports/channel-policy/data/all.ts`'s own `COUNTRY_FILES` already has.
const COUNTRY_FILES = ['fr'] as const;

function loadCountryFile(code: string): CountryMentionsFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryMentionsFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/mentions/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const entry of parsed.invoiceNotes ?? []) {
    assertValidMentionRule(entry, `documents/mentions/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's mandatory mentions, one file per country — see the module docstring. A
 *  country with no entry here has no mention at all: `invoice-notes.ts#resolveInvoiceNotes` emits
 *  nothing for it, and every existing CII/UBL/PDF test for a non-FR document is unaffected. */
export const ALL_MENTIONS_FILES: CountryMentionsFile[] = COUNTRY_FILES.map(loadCountryFile);

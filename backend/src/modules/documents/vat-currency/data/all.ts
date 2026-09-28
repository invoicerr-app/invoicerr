/**
 * The only aggregator: adding a country's VAT-currency rule means adding `data/xx.json` and NOTHING
 * else, never an engine change. Same shape as `../../content-requirements/data/all.ts` (same reason
 * too: `fs.readFileSync` rather than `import`, so editing a fact, or its citation, is a plain data
 * change needing no rebuild step beyond what any other data file in this repo already needs,
 * `nest-cli.json`'s own `**\/*.json` asset rule; see the root `CLAUDE.md`'s own warning that a file
 * ADDED while `nest start --watch` is already running needs an explicit restart to actually reach
 * `dist/`).
 *
 * Every rule is validated HERE, at load time (`assertValidVatCurrencyRule`, schema.ts), so a rule
 * with no citation, no rate source, or a `requiredOnInvoice: true` with nowhere to source a rate from
 * fails as soon as this module is imported (at boot), never silently.
 *
 * Five countries ship today: FR/PL/IT (the ones issue #517 names as having a REAL, sourced invoice
 * obligation) plus DE/PT (both wired with `requiredOnInvoice: false`, each a genuine researched
 * conclusion rather than an omission, see each file's own `notes`). The list is DISCOVERED, not
 * hand-maintained: `discoverCountryCodes()` reads this directory with `readdirSync` and keeps only
 * names matching `/^[a-z]{2}\.json$/` (a lowercase two-letter code plus `.json`, which is a country
 * file and nothing else, excluding this `all.ts` and `all.spec.ts`, neither of which is `.json`). A
 * country with NO file here (every one outside these five) is left alone entirely by
 * `registry.ts#resolveVatCurrencyRule` (returns `null`), the same "no known catalog blocks nobody"
 * permissiveness `vat-rates/registry.ts`'s own header documents for a different catalog, never a
 * hard block on an otherwise-unrelated country's invoice.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatCurrencyRule, CountryVatCurrencyFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order. See the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryVatCurrencyFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryVatCurrencyFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/vat-currency/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  assertValidVatCurrencyRule(parsed, `documents/vat-currency/data/${code}.json`);
  return parsed;
}

/** Every wired jurisdiction's VAT-currency rule, one file per country. See the module docstring: a
 *  country with no entry here is permissively left alone by `registry.ts#resolveVatCurrencyRule`
 *  (returns `null`), never a silent "not required" and never a hard block either. */
export const ALL_VAT_CURRENCY_FILES: CountryVatCurrencyFile[] = discoverCountryCodes().map(loadCountryFile);

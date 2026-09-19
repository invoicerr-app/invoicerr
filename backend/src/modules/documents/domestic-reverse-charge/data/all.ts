/**
 * The only aggregator — adding a country's domestic reverse-charge categories means adding
 * `data/xx.json`, nothing else, mirroring `mentions/data/all.ts`'s own header verbatim on why the list
 * is DISCOVERED (`readdirSync`), never a hand-maintained array like `country-fields/data/all.ts`'s own
 * `COUNTRY_FILES` constant: a fixed array is one more place a shipped file can be forgotten, and this
 * catalog's own task brief was explicit that it must not repeat that shape.
 *
 * Every category is validated HERE, at load time (`assertValidDomesticReverseChargeCategory` —
 * `../schema.ts`), so a category with no `legalRef` or no provenance fails as soon as this module is
 * imported (at boot), never silently — the same "a fact without a citation does not load" discipline
 * `mentions/data/all.ts` and `transports/channel-policy/data/all.ts` already hold for their own facts.
 *
 * FOUR countries ship today: DE, FR, IT, PT — each read against its primary source on 2026-09-13 (see
 * each file's own per-category `provenance.sourceText`/`sourceCheckedAt`). Poland does NOT ship: this
 * brief established Poland's own PRESCRIBED WORDING for a reverse-charge invoice (ustawa o VAT art.
 * 106e ust. 1 pkt 18 — already encoded as `LOCALIZED_MENTION.reverseCharge.PL` in `tax/tax-engine.ts`)
 * but never retrieved WHICH domestic transactions actually trigger it for Poland specifically (that
 * pkt only defines the wording a reverse-charge invoice must carry once one applies — it is not itself
 * a category list). Poland's own historic domestic-construction reverse charge (za łącznik 14) was
 * repealed 2019-11-01 and replaced by mandatory split payment — a real fact, but recalled from training
 * data rather than read from ustawa o VAT's own current text, so it is NOT encoded here either: this
 * catalog would rather ship zero Polish categories than one guessed from memory. A `data/pl.json` is a
 * real, welcome follow-up — it needs its own primary-source retrieval, not an inference from this
 * file's own header.
 *
 * The list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory with
 * `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code plus
 * `.json`, excluding this `all.ts` and `all.spec.ts`, neither of which is `.json`. Adding a fifth
 * country (Poland, once sourced) is exactly its own `data/xx.json`, no line to add here — `readdirSync`
 * makes no ordering promise, so the codes are sorted before loading regardless of how many ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidDomesticReverseChargeCategory, CountryDomesticReverseChargeFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic load
 *  order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryDomesticReverseChargeFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryDomesticReverseChargeFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/domestic-reverse-charge/data/${code}.json declares countryCode ` +
        `"${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  for (const category of parsed.categories ?? []) {
    assertValidDomesticReverseChargeCategory(category, `documents/domestic-reverse-charge/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's domestic reverse-charge categories, one file per country — see the
 *  module docstring. A country with no entry here has NO known category: nothing reads this catalog
 *  yet (see this directory's own `schema.ts` header), so that absence changes no existing behaviour —
 *  it only means a future caller has nothing to offer for that country, exactly the same "no permissive
 *  fallback, no silent guess" posture `country-policy/country-policy.ts` already documents for its own
 *  concern. */
export const ALL_DOMESTIC_REVERSE_CHARGE_FILES: CountryDomesticReverseChargeFile[] =
  discoverCountryCodes().map(loadCountryFile);

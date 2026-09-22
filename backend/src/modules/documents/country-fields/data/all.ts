/**
 * The only aggregator — adding a country's field overlay means adding `data/xx.json` and NOTHING
 * else, mirroring `archive/retention/data/all.ts`'s own header verbatim on why this reads the
 * directory with `readdirSync` rather than hand-maintaining a list of country codes: dropping a
 * second country's `data/xx.json` here used to do NOTHING until a maintainer also remembered to add
 * its code to a `COUNTRY_FILES` array — silently, since nothing failed, an overlay for a country
 * nobody wired that way ever loaded either (fixed 2026-09-13, the same fix `archive/retention/` and
 * ten of this module's other eleven catalogs already had; this was the last hand-maintained one).
 *
 * FIRST REAL FILE LANDED: France's own `data/fr.json`, adding an OPTIONAL `supplyType` subfield to
 * `invoice.lines` — the concrete "add/modify/remove" need this directory's own header used to say
 * had not shown up yet. It arrived exactly the way that header predicted a second pass would justify
 * one: BT-23 (`formats/semantic/business-process.ts`) needs to
 * know, PER LINE, whether it is a good or a service, a fact `descriptors/invoice.descriptor.ts`'s own
 * trunk line shape has no field for and should not gain unconditionally (asserting a French legal
 * category's INPUT on every country's invoice line would be the same "no business code names a
 * country" violation the value itself was already refused for — see that file's own header). This is
 * still NOT a case of "a trunk field turned out to be France's own" (the mechanism `apply-overlay.ts`
 * was originally built, and kept empty here, to prove) — it is the OTHER honest use of the same
 * three-operation vocabulary: a field only ONE country's law currently gives any meaning to, added
 * rather than moved.
 *
 * The list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this directory with
 * `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase two-letter code plus
 * `.json`, which is a country file and nothing else (it excludes this `all.ts` and `all.spec.ts`,
 * neither of which is `.json`). Adding a second country's overlay is exactly its own `data/xx.json`,
 * no line to add here — `readdirSync` makes no ordering promise, so the codes are sorted before
 * loading regardless of how many ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCountryFields, CountryFieldOverlayFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryFieldOverlayFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryFieldOverlayFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/country-fields/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  // The one gate this catalog was missing relative to every other `data/all.ts` loader — see
  // schema.ts's own `assertValidCountryFields` header for the full "why" (no provenance to check
  // here, unlike country-policy/, but the SHAPE of every operation still has to be sound).
  assertValidCountryFields(parsed, `documents/country-fields/data/${code}.json`);
  return parsed;
}

/** Every wired jurisdiction's field overlay, one file per country — see the module docstring above
 *  for what France's and Germany's own overlays add, and each country file's own `notes` for the
 *  rest. All five wired countries now carry the SAME `lines[].supplyType` operation, added to the
 *  four others after France's: it is a Directive 2006/112/EC distinction (arts. 33(a)/45, via
 *  `../../tax/resolve-invoice-tax.ts`) that binds every member state identically, so the country
 *  files differ only in which national text they cite for it. A country with NO entry here gets the
 *  trunk fields UNCHANGED — the ordinary case, not a misconfiguration (see
 *  country-fields/registry.ts's own `operationsFor`). */
export const ALL_COUNTRY_FIELD_OVERLAY_FILES: CountryFieldOverlayFile[] =
  discoverCountryCodes().map(loadCountryFile);

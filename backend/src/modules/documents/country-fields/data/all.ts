/**
 * The only aggregator — adding a country's field overlay means adding `data/xx.json` plus one line
 * here, never an engine change. Same shape as country-policy/data/all.ts and
 * vat-rates/data/all.ts.
 *
 * FIRST REAL FILE LANDED: France's own `data/fr.json`, adding an OPTIONAL `supplyType` subfield to
 * `invoice.lines` — the concrete "add/modify/remove" need this directory's own header used to say
 * had not shown up yet. It arrived exactly the way that header predicted a second pass would justify
 * one: BT-23 (root TODO item 15's own remainder, `formats/semantic/business-process.ts`) needs to
 * know, PER LINE, whether it is a good or a service, a fact `descriptors/invoice.descriptor.ts`'s own
 * trunk line shape has no field for and should not gain unconditionally (asserting a French legal
 * category's INPUT on every country's invoice line would be the same "no business code names a
 * country" violation the value itself was already refused for — see that file's own header). This is
 * still NOT a case of "a trunk field turned out to be France's own" (the mechanism `apply-overlay.ts`
 * was originally built, and kept empty here, to prove) — it is the OTHER honest use of the same
 * three-operation vocabulary: a field only ONE country's law currently gives any meaning to, added
 * rather than moved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CountryFieldOverlayFile } from '../schema';

const COUNTRY_FILES: readonly string[] = ['fr', 'de'];

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
  return parsed;
}

/** Every wired jurisdiction's field overlay, one file per country — see the module docstring above
 *  for why this is empty today. A country with NO entry here gets the trunk fields UNCHANGED — the
 *  ordinary case, not a misconfiguration (see country-fields/registry.ts's own `operationsFor`). */
export const ALL_COUNTRY_FIELD_OVERLAY_FILES: CountryFieldOverlayFile[] = COUNTRY_FILES.map(loadCountryFile);

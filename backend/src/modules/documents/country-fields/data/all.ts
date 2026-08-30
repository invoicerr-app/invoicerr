/**
 * The only aggregator — adding a country's field overlay means adding `data/xx.json` plus one line
 * here, never an engine change. Same shape as country-policy/data/all.ts and
 * vat-rates/data/all.ts.
 *
 * EMPTY today, deliberately — see this directory's own README-in-code below. The mechanism
 * (apply-overlay.ts) is fully implemented and tested against synthetic fixtures
 * (apply-overlay.spec.ts); what is NOT here yet is a real, shipped reason for France (or anyone
 * else) to use it.
 *
 * Why France ships no overlay file, even though this task's whole point was "France, and then a
 * surcouche mechanism": the user's own stated methodology (see the invoice descriptor's own header)
 * is "on fait un pays à la fois — on fait un premier pays [...] Ensuite on fait un autre pays, et si
 * on se rend compte que certains champs étaient spécifiques au premier pays, on les déplace." France
 * IS the first pass: descriptors/invoice.descriptor.ts was written FROM France's own needs directly,
 * so by construction there is nothing yet that needs adding, modifying, or removing FOR France
 * specifically — everything France needs is already sitting in the trunk (marked with a
 * "SUSPECTED FRANCE-SPECIFIC" comment where it might not generalize — see that file). Shipping a
 * synthetic overlay just to exercise all three operations for real would mean inventing a product or
 * legal need nobody asked for, which is precisely what this branch's own audit history (see
 * vat-rates/data/fr.json's own honesty about unverified provenance) warns against doing for a lower
 * stake than "which fields exist". The day a SECOND country's pass reveals a trunk field that turns
 * out to only ever have been France's, THAT country's file gets a `remove`, or France's own first
 * file finally appears with the fields that turned out to be add/modify-worthy — not before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CountryFieldOverlayFile } from '../schema';

const COUNTRY_FILES: readonly string[] = [];

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

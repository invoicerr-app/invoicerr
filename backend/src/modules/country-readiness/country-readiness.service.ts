import { Injectable } from '@nestjs/common';

import { ALL_COUNTRY_POLICY_FILES } from '@/modules/documents/country-policy/data/all';
import { ALL_CORRECTION_ROUTES_FILES } from '@/modules/documents/correction-routes/data/all';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '@/modules/documents/country-identifiers/data/all';
import { ALL_TAX_SYSTEM_FILES } from '@/modules/documents/tax/tax-systems/data/all';
import { ALL_VAT_RATE_FILES } from '@/modules/documents/vat-rates/data/all';

/**
 * The five CŒUR mechanisms a country needs to be "complete" — a business decision,
 * NOT something discovered from disk. `mentions/` and `content-requirements/` are deliberately left
 * out: they are FR-specific extras that no other jurisdiction is expected to ship, so requiring them
 * would make every non-FR country "incomplete" forever regardless of how well it is actually covered.
 *
 * What IS fully data-driven is which countries satisfy each mechanism below: every entry's
 * `countryCodes` is read straight from that mechanism's own `ALL_*_FILES` catalog (the same
 * auto-discovered, `fs.readdirSync`-backed export every seed/registry in `documents/` already reads —
 * see e.g. `country-policy/data/all.ts`'s own header). Adding, removing, or completing a country's
 * `data/xx.json` file in any of these five directories changes this service's answer with NO code
 * change here — exactly the "a country is data" principle `COMPLIANCE_ARCHITECTURE.md` describes for
 * the (now removed) compliance engine, carried over to this leaner, data-only successor.
 */
interface CoreMechanism {
  /** Stable id surfaced in `present`/`missing` — matches the mechanism's own directory name under
   *  `documents/`, so a caller (or a support issue) can go straight from this string to the exact
   *  `data/xx.json` file that would need to be added. */
  id: string;
  countryCodes: ReadonlySet<string>;
}

function toCountryCodeSet(files: readonly { countryCode: string }[]): ReadonlySet<string> {
  return new Set(files.map((f) => f.countryCode.toUpperCase()));
}

const CORE_MECHANISMS: readonly CoreMechanism[] = [
  { id: 'country-policy', countryCodes: toCountryCodeSet(ALL_COUNTRY_POLICY_FILES) },
  { id: 'vat-rates', countryCodes: toCountryCodeSet(ALL_VAT_RATE_FILES) },
  { id: 'tax-systems', countryCodes: toCountryCodeSet(ALL_TAX_SYSTEM_FILES) },
  { id: 'correction-routes', countryCodes: toCountryCodeSet(ALL_CORRECTION_ROUTES_FILES) },
  { id: 'country-identifiers', countryCodes: toCountryCodeSet(ALL_COUNTRY_IDENTIFIER_FILES) },
];

export interface CountryReadiness {
  /** Always uppercased, regardless of the casing the caller queried with. */
  countryCode: string;
  /** `true` only when every one of the five core mechanisms above has a file for this country —
   *  `missing` is then empty. */
  complete: boolean;
  /** Core mechanism ids that DO have a `data/xx.json` file for this country, in the fixed order
   *  `CORE_MECHANISMS` declares them (not alphabetical, not discovery order). */
  present: string[];
  /** Core mechanism ids that do NOT have a file for this country — empty exactly when `complete`. */
  missing: string[];
}

@Injectable()
export class CountryReadinessService {
  /**
   * Called from onboarding and from company settings — deliberately BEFORE a company necessarily
   * exists (see this module's controller for why it carries no `@ActiveCompany()`), so this never
   * throws for an unknown or malformed code: an unrecognized country is simply "present in none of
   * the five", the same "no permissive fallback, no silent guess, just an honest gap" shape every
   * sibling catalog in `documents/` already holds (see e.g. `correction-routes/registry.ts`'s header).
   */
  getReadiness(countryCode: string): CountryReadiness {
    const code = (countryCode ?? '').trim().toUpperCase();
    const present: string[] = [];
    const missing: string[] = [];
    for (const mechanism of CORE_MECHANISMS) {
      (mechanism.countryCodes.has(code) ? present : missing).push(mechanism.id);
    }
    return { countryCode: code, complete: missing.length === 0, present, missing };
  }

  /**
   * Country codes present in EVERY core mechanism — i.e. every `countryCode` `getReadiness` would
   * answer `complete: true` for. Optional convenience for the frontend to highlight fully-supported
   * countries; not itself required by any onboarding flow. Sorted for a stable, deterministic
   * response — the same discipline every mechanism's own `registry.ts#countries()` already follows.
   */
  listFullySupportedCountries(): string[] {
    const [first, ...rest] = CORE_MECHANISMS.map((m) => m.countryCodes);
    if (!first) return [];
    const fullySupported = [...first].filter((code) => rest.every((codes) => codes.has(code)));
    return fullySupported.sort();
  }
}

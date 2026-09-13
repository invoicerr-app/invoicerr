import { Injectable } from '@nestjs/common';

import { ALL_COUNTRY_POLICY_FILES } from '@/modules/documents/country-policy/data/all';
import { ALL_CORRECTION_ROUTES_FILES } from '@/modules/documents/correction-routes/data/all';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '@/modules/documents/country-identifiers/data/all';
import { ALL_TAX_SYSTEM_FILES } from '@/modules/documents/tax/tax-systems/data/all';
import { ALL_VAT_RATE_FILES } from '@/modules/documents/vat-rates/data/all';
import { ALL_CHANNEL_POLICY_FILES } from '@/modules/documents/transports/channel-policy/data/all';

/**
 * The six CŒUR mechanisms a country needs to be "complete" — a business decision, NOT something
 * discovered from disk. Twelve catalogs exist under `documents/`; the other six are deliberately left
 * out, and — unlike the historical version of this comment — each one for its OWN stated reason,
 * because the reasons genuinely differ:
 *
 *  - `mentions/` and `content-requirements/` are FR-specific extras: no other in-scope jurisdiction's
 *    law has been found to require either one, so counting them would make every non-FR country
 *    "incomplete" forever regardless of how well it is actually covered — an artifact of France being
 *    the first country sourced, not a real gap in the other four.
 *  - `country-fields/` is genuinely OPTIONAL, not sparse: a country having NO overlay file is the
 *    ordinary case, not a gap — the trunk `DocumentTypeDescriptor` already covers every field a
 *    document type needs by default, and a country only gets an overlay when its own law needs a
 *    field the trunk lacks (or forbids one it has). FR and DE need one today; that a third country
 *    might never need one is not evidence of missing work (see `country-fields/schema.ts`'s own
 *    header).
 *  - `b2g-routing/` only matters for an invoice whose BUYER is a government entity — a subset of one
 *    country's invoices, never all of them — so a country missing a rule here can still be fully
 *    compliant for every ordinary B2B/B2C invoice it issues. Separately, and unlike the other three
 *    exclusions below, this one also has an open sourcing gap among the five in-scope countries: PT
 *    was investigated (pre-dating the five-country prune) and found to have no confirmed vendorable
 *    national CIUS or confirmed Peppol reachability at the time — a finding that has not been
 *    revisited since, not a conclusion that Portugal has no B2G obligation.
 *  - `archive/retention/` is a real sourcing gap, not a design choice, for one of the five: DE/FR/PL/PT
 *    are sourced, but Italy was investigated and left out because its primary source (normattiva.it)
 *    would not render as raw text — this codebase's own discipline requires reading a statute's raw
 *    text, never a fetched summary, before a `legalRef` ships (see `archive/retention/data/all.spec.ts`
 *    own comment). Unlike `b2g-routing/`, a retention duration applies to EVERY invoice a country
 *    issues, not a subset — see this service's own report for why that makes this exclusion the one
 *    most worth revisiting, which is exactly why it is flagged here rather than added.
 *  - `reporting/` ships PORTUGAL ONLY: NAV Hungary and AADE myDATA Greece were deleted wholesale with
 *    the five-country prune (2026-09-10) because neither Hungary nor Greece stayed in scope. None of
 *    the other four in-scope countries (DE/FR/IT/PL) has been evaluated for a genuinely separate
 *    post-send declaration obligation distinct from their own transmission channel — an unresearched
 *    gap, not a finding that only Portugal has one.
 *
 * What IS fully data-driven is which countries satisfy each of the six mechanisms below: every entry's
 * `countryCodes` is read straight from that mechanism's own `ALL_*_FILES` catalog (the same
 * auto-discovered, `fs.readdirSync`-backed export every seed/registry in `documents/` already reads —
 * see e.g. `country-policy/data/all.ts`'s own header). Adding, removing, or completing a country's
 * `data/xx.json` file in any of these six directories changes this service's answer with NO code
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
  { id: 'channel-policy', countryCodes: toCountryCodeSet(ALL_CHANNEL_POLICY_FILES) },
];

export interface CountryReadiness {
  /** Always uppercased, regardless of the casing the caller queried with. */
  countryCode: string;
  /** `true` only when every one of the six core mechanisms above has a file for this country —
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
   * the six", the same "no permissive fallback, no silent guess, just an honest gap" shape every
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

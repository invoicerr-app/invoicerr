import { Injectable } from '@nestjs/common';

import { ALL_COUNTRY_POLICY_FILES } from '@/modules/documents/country-policy/data/all';
import { ALL_CORRECTION_ROUTES_FILES } from '@/modules/documents/correction-routes/data/all';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '@/modules/documents/country-identifiers/data/all';
import { ALL_TAX_SYSTEM_FILES } from '@/modules/documents/tax/tax-systems/data/all';
import { ALL_VAT_RATE_FILES } from '@/modules/documents/vat-rates/data/all';
import { ALL_CHANNEL_POLICY_FILES } from '@/modules/documents/transports/channel-policy/data/all';
import { ALL_MENTIONS_FILES } from '@/modules/documents/mentions/data/all';
import { CountryMentionsFile, TemporalValue } from '@/modules/documents/mentions/schema';

/**
 * The six CŒUR mechanisms a country needs to be "complete" — a business decision, NOT something
 * discovered from disk. Thirteen catalogs exist under `documents/` (one `data/all.ts` aggregator
 * each — see `ALL_DOCUMENT_CATALOG_DIRS` below, which this comment's own count is checked against);
 * the other seven are deliberately left out, and — unlike the historical version of this comment —
 * each one for its OWN stated reason, because the reasons genuinely differ:
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
 *    issues, not a subset it could be legitimately exempt from — of the four exclusions here, this is
 *    the one where "not core" rests entirely on a temporary sourcing gap rather than on the mechanism
 *    being genuinely conditional, and is therefore the strongest candidate to promote once Italy is
 *    sourced. Left out of `CORE_MECHANISMS` deliberately for now: promoting it today would make Italy
 *    the only incomplete one of the five in-scope countries purely because of this unresolved gap — a
 *    real product trade-off for whoever owns the completeness definition, not one this comment should
 *    decide unilaterally.
 *  - `reporting/` ships PORTUGAL ONLY: NAV Hungary and AADE myDATA Greece were deleted wholesale with
 *    the five-country prune (2026-09-10) because neither Hungary nor Greece stayed in scope. None of
 *    the other four in-scope countries (DE/FR/IT/PL) has been evaluated for a genuinely separate
 *    post-send declaration obligation distinct from their own transmission channel — an unresearched
 *    gap, not a finding that only Portugal has one.
 *  - `domestic-reverse-charge/` is excluded for a DIFFERENT reason than the six above: it is not
 *    conditional, nor a sourcing gap — it is sourced (DE/FR/IT/PT, 32 categories) but wired into
 *    NOTHING yet. `tax/tax-engine.ts` has no domestic-reverse-charge branch at all (see that catalog's
 *    own `DESIGN.md`, "Step 1 of the task brief… the only implementation this wave carries out"), so a
 *    country having this catalog's file says nothing about what an actual invoice from that country
 *    does — unlike the six CORE_MECHANISMS below, every one of which IS read by a real request-serving
 *    code path today. Counting it as core would make "complete" claim a behaviour that does not exist
 *    yet; promote it once a tax-engine branch actually reads it.
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
  /** Path to this mechanism's own directory, relative to `documents/` — differs from `id` for the two
   *  nested catalogs (`tax/tax-systems`, `transports/channel-policy`). Used only to build
   *  `ALL_DOCUMENT_CATALOG_DIRS` below; never read by `getReadiness` itself. */
  dir: string;
  countryCodes: ReadonlySet<string>;
}

function toCountryCodeSet(files: readonly { countryCode: string }[]): ReadonlySet<string> {
  return new Set(files.map((f) => f.countryCode.toUpperCase()));
}

const CORE_MECHANISMS: readonly CoreMechanism[] = [
  { id: 'country-policy', dir: 'country-policy', countryCodes: toCountryCodeSet(ALL_COUNTRY_POLICY_FILES) },
  { id: 'vat-rates', dir: 'vat-rates', countryCodes: toCountryCodeSet(ALL_VAT_RATE_FILES) },
  { id: 'tax-systems', dir: 'tax/tax-systems', countryCodes: toCountryCodeSet(ALL_TAX_SYSTEM_FILES) },
  {
    id: 'correction-routes',
    dir: 'correction-routes',
    countryCodes: toCountryCodeSet(ALL_CORRECTION_ROUTES_FILES),
  },
  {
    id: 'country-identifiers',
    dir: 'country-identifiers',
    countryCodes: toCountryCodeSet(ALL_COUNTRY_IDENTIFIER_FILES),
  },
  {
    id: 'channel-policy',
    dir: 'transports/channel-policy',
    countryCodes: toCountryCodeSet(ALL_CHANNEL_POLICY_FILES),
  },
];

/** Catalog directories deliberately excluded from `CORE_MECHANISMS` — one entry per bullet in the
 *  comment above, same order, each for the reason its own bullet documents. */
const EXCLUDED_CATALOG_DIRS: readonly string[] = [
  'mentions',
  'content-requirements',
  'country-fields',
  'b2g-routing',
  'archive/retention',
  'reporting',
  'domestic-reverse-charge',
];

/**
 * Every catalog directory under `documents/` that ships a `data/all.ts` aggregator — the six core
 * mechanisms above PLUS the seven deliberately-excluded ones — exported so
 * `country-readiness.service.spec.ts` can auto-discover the REAL set on disk (scanning for
 * `data/all.ts` files, the same signature every catalog's own loader uses — see e.g.
 * `country-policy/data/all.ts`'s header) and assert it matches this list one-for-one. That is the
 * actual fix for this file's own past bug: the catalog count used to live only as prose in the
 * comment above ("Twelve catalogs…") and silently went stale the day `domestic-reverse-charge/` was
 * added without a corresponding update here — a thirteenth catalog invisible to both this list and
 * that count. A spec that re-derives the total from disk turns that class of drift into a failing
 * test instead of a stale comment.
 */
export const ALL_DOCUMENT_CATALOG_DIRS: readonly string[] = [
  ...CORE_MECHANISMS.map((m) => m.dir),
  ...EXCLUDED_CATALOG_DIRS,
];

/** How far ahead a bounded `noteValues` window's own coverage horizon is allowed to sit before it
 *  becomes an alert — see `computeMentionWindowAlerts`'s own header for what "coverage horizon" means. */
const MENTION_WINDOW_ALERT_THRESHOLD_DAYS = 90;

export interface MentionWindowAlert {
  /** ISO 3166-1 alpha-2, uppercase — the mentions file this window belongs to. */
  countryCode: string;
  /** The `noteValues` key this window interpolates into a mention's own `{placeholder}` (e.g.
   *  "lateFeeRate") — matches `mentions/schema.ts#CountryMentionsFile.noteValues`'s own keys. */
  field: string;
  /** The LATEST `validTo` across this field's own value table — the point past which NO entry covers
   *  an invoice's issue date at all (see this function's own header). */
  expiresOn: string;
  /** Negative once the window has ALREADY closed with nothing yet covering it — a maintenance lapse
   *  already in effect today, not merely approaching. Never rounded up: an alert that reads "1 day
   *  left" when there are in fact 18 hours left is the wrong direction to be optimistic in. */
  daysRemaining: number;
}

/**
 * Turns a `documents/mentions/data/*.json` file that WILL (or already does) leave a mention's own
 * `{placeholder}` unresolved into an operational alert — see `mentions/invoice-notes.ts`'s own
 * `UnresolvedInvoiceNotePlaceholderError` for what happens the day this actually lapses: every
 * invoice for that country hard-refuses to build (`build-semantic-invoice.ts`/`render-instance-pdf.ts`
 * both convert it to a named 400), never a silently-printed `{token}` — but a hard 400 on every
 * invoice in a jurisdiction is still a real outage, and the WHOLE point of an alert like this one is
 * that it must never be the first anyone hears of it. "Pas de panne silencieuse programmée."
 *
 * A field's own value table (`TemporalValue[]`) has a genuine coverage GAP coming only when EVERY
 * entry in it is itself bounded (`validTo` set) — the moment even ONE entry is open-ended (no
 * `validTo` at all), that field is covered indefinitely and this function has nothing to warn about
 * for it, regardless of what any OTHER, earlier-ending entry might suggest (an earlier bounded window
 * immediately followed by a later one — or by an open-ended one — is not a gap, it is ordinary
 * scheduled maintenance already done). When every entry IS bounded, the field's own "coverage
 * horizon" is the LATEST `validTo` among them — this deliberately does not attempt to detect an
 * INTERNAL gap between two non-contiguous bounded windows (every catalog shipped today keeps its own
 * windows contiguous by convention — see e.g. `mentions/data/fr.json`'s own "TO BE MAINTAINED TWICE A
 * YEAR" note — so the one gap that actually matters in practice is always the trailing one).
 *
 * Returns one alert per (country, field) whose horizon is within `MENTION_WINDOW_ALERT_THRESHOLD_DAYS`
 * of `now` — INCLUDING a horizon already in the past (`daysRemaining` negative): a lapse that already
 * happened is a stronger, not a weaker, reason to alert. `now` is an explicit parameter (never read as
 * `new Date()` deep inside a loop) purely so this stays trivially testable against a fixed clock — it
 * is NOT the same "freeze at issue date" clock discipline `resolveInvoiceNotes` itself holds (that one
 * judges a SPECIFIC document; this one judges the CATALOG's own health today, which is inherently
 * about "today").
 *
 * `files` defaults to the real shipped catalog (`ALL_MENTIONS_FILES`) — overridable so a spec can feed
 * a synthetic fixture and assert this function's own edge cases (an exactly-at-threshold horizon, an
 * already-past one, an open-ended table) without depending on whatever dates happen to be in
 * `mentions/data/fr.json` on the day the spec runs, the same `files = ALL_*_FILES` default-parameter
 * testability pattern `vat-rates/registry.ts#VatRateCatalog`'s own constructor already holds.
 */
export function computeMentionWindowAlerts(
  now: Date = new Date(),
  files: readonly Pick<CountryMentionsFile, 'countryCode' | 'noteValues'>[] = ALL_MENTIONS_FILES,
): MentionWindowAlert[] {
  const alerts: MentionWindowAlert[] = [];
  for (const file of files) {
    for (const [field, entries] of Object.entries(file.noteValues ?? {}) as [string, TemporalValue[]][]) {
      if (entries.length === 0) continue;
      if (entries.some((entry) => !entry.validTo)) continue;

      const boundedEntries = entries as Array<TemporalValue & { validTo: string }>;
      const horizon = boundedEntries.reduce(
        (latest, entry) => (entry.validTo > latest ? entry.validTo : latest),
        boundedEntries[0].validTo,
      );
      const daysRemaining = Math.floor((new Date(horizon).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysRemaining <= MENTION_WINDOW_ALERT_THRESHOLD_DAYS) {
        alerts.push({
          countryCode: file.countryCode.toUpperCase(),
          field,
          expiresOn: horizon,
          daysRemaining,
        });
      }
    }
  }
  return alerts;
}

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

  /** Thin DI-friendly wrapper — see the free `computeMentionWindowAlerts` function's own header for the
   *  full "why". Kept as a standalone function (not only a method) so it stays trivially importable
   *  from a spec or a sweep with no `CountryReadinessService` instance needed, the same split this
   *  file's own module-level `ALL_DOCUMENT_CATALOG_DIRS` already draws for the SAME reason. */
  getMentionWindowAlerts(now: Date = new Date()): MentionWindowAlert[] {
    return computeMentionWindowAlerts(now);
  }
}

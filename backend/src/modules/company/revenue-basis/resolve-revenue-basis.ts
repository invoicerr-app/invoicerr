/**
 * Issue #516 - "a revenue-basis setting per company (invoiced or cashed; monthly or quarterly),
 * defaulted from country and regime where clear, always editable". This product tracks a company's
 * `countryCode` but no legal-form/regime field at all (no "micro-entrepreneur", "regime forfettario"
 * or similar column exists anywhere in this schema) - so a country-only default can only honestly
 * speak to the regime that is BOTH (a) the one this issue's own research names as clearly
 * cashed-basis for that country, AND (b) common enough among this product's own target users (freelancers
 * and small businesses) that defaulting to it is more likely right than wrong. Where that is not the
 * case, the honest default is "invoiced" - this product's own PRE-EXISTING behavior (every "Invoiced
 * this month" dashboard tile already counts by issue date), so a company this resolver cannot place
 * confidently sees NO CHANGE from what it already had.
 *
 * Sources: `RECHERCHE_192_MULTIDEVISE.md` §3 ("Base du chiffre d'affaires : facturé ou encaissé"),
 * itself citing (verbatim, §"Sources (citations longues)"):
 *
 *  - FR, micro-entrepreneur: urssaf.fr - "le chiffre d'affaires à déclarer est celui qui a été
 *    encaissé au cours de cette période" - CASHED. The single most common legal form this product's
 *    own French freelance users register under, so FR defaults to "cashed".
 *  - IT, regime forfettario: L. 190/2014 art. 1 comma 64 - taxed on "ricavi o […] compensi
 *    percepiti" (received, i.e. cashed), and this regime carries NO VAT at all (comma 58/59) - the
 *    single most common regime for an Italian freelancer this product targets, so IT defaults to
 *    "cashed".
 *  - DE, Freiberufler: cashed for INCOME TAX (§11 Abs. 1 EStG) but the VAT itself stays
 *    accrual-by-default (Sollversteuerung, §20 UStG's Istversteuerung is granted only ON REQUEST)  -
 *    genuinely mixed, not "clear" either way. Defaults to "invoiced" (unchanged from today).
 *  - PL: invoiced by default (Loi PIT, art. 14 ust. 1c) - "kasowy PIT" is an explicit, written OPT-IN
 *    since the 27/09/2024 law. Defaults to "invoiced".
 *  - PT, recibos verdes: CIRS art. 3.º, n.º 6 places the taxable moment at whenever a VAT invoice
 *    becomes mandatory, which tracks ISSUANCE far more closely than payment; "IVA de caixa" is an
 *    explicit opt-in (DL 71/2013, as amended). Defaults to "invoiced".
 *  - Every other country this resolver has no researched regime for: "invoiced" - the product's own
 *    unchanged, pre-existing behavior.
 *
 * `revenuePeriod`'s own default ("monthly"): the research found NO sourced text naming monthly as
 * THE legal default when a micro-entrepreneur declares neither choice explicitly - URSSAF's own
 * quoted text requires an explicit choice ("chaque mois ou chaque trimestre") without stating a
 * fallback. "Monthly" is chosen here as a DESIGN default, not a claimed legal one: it is the finer of
 * the two granularities, so a reader can always aggregate a monthly view up into a quarter by hand,
 * but never split a quarterly figure back into months - same "prefer the direction that loses no
 * information" reasoning this codebase already applies elsewhere (see e.g. `archive/retention/`'s own
 * "never guess a shorter retention" posture). Applies uniformly, regardless of country.
 */

import { BadRequestException } from '@nestjs/common';

export type RevenueBasis = 'invoiced' | 'cashed';
export type RevenuePeriod = 'monthly' | 'quarterly';

/** Countries this issue's own research found a CLEAR cashed-basis default for - see this file's own
 *  header for why DE/PL/PT are deliberately absent (each has a real but non-clear or opt-in cash
 *  regime, not a default one). ISO 3166-1 alpha-2, matching `Company.countryCode`. */
const CASHED_BASIS_DEFAULT_COUNTRIES: ReadonlySet<string> = new Set(['FR', 'IT']);

/** `Company.revenueBasis`/`Company.revenuePeriod` are free strings (see schema.prisma's own comment
 *  on why, mirroring `referenceCurrency`) - this is the one narrowing step every reader goes through,
 *  same "unrecognized stored value treated as unset" posture
 *  `documents/tax/resolve-invoice-tax.ts#parseDistanceSalesRegime` already holds. */
function parseRevenueBasis(value: string | null | undefined): RevenueBasis | null {
  if (value === 'invoiced' || value === 'cashed') return value;
  return null;
}

function parseRevenuePeriod(value: string | null | undefined): RevenuePeriod | null {
  if (value === 'monthly' || value === 'quarterly') return value;
  return null;
}

export interface RevenueBasisDefault {
  basis: RevenueBasis;
  /** Plain-English, for the settings screen - cites exactly what this file's own header cites, so a
   *  company reading the "why" behind its own default sees a real source, not a guess. */
  reason: string;
}

/** The per-country default this issue's own research supports - see this file's own header for the
 *  full table and sources. `countryCode` is compared case-insensitively and trimmed, matching how
 *  `settings/-[tab].tsx` (frontend) already normalizes `Company.countryCode` for its own country
 *  checks. */
export function defaultRevenueBasisFor(countryCode: string | null | undefined): RevenueBasisDefault {
  const normalized = (countryCode ?? '').trim().toUpperCase();
  if (CASHED_BASIS_DEFAULT_COUNTRIES.has(normalized)) {
    return {
      basis: 'cashed',
      reason:
        normalized === 'FR'
          ? 'French micro-entrepreneurs declare cashed revenue (urssaf.fr; CSS art. R133-30-1 to 10).'
          : 'Italian regime forfettario taxes revenue received, not invoiced (L. 190/2014 art. 1 c. 64).',
    };
  }
  return {
    basis: 'invoiced',
    reason:
      'No clear cashed-basis default found for this country - kept at "invoiced", this product’s own ' +
      'pre-existing behavior (dashboard totals already count by issue date).',
  };
}

export interface ResolvedRevenueSettings {
  basis: RevenueBasis;
  period: RevenuePeriod;
  /** `true` when `basis` is the company's OWN explicit choice (`Company.revenueBasis` set), `false`
   *  when it is the computed per-country default below - the settings screen uses this to show
   *  "default" vs. the company's own pick, never guessing from the value alone (an explicit "invoiced"
   *  in a country whose default is also "invoiced" must still read as explicit, not as "unset"). */
  basisIsExplicit: boolean;
  basisDefaultReason: string;
  periodIsExplicit: boolean;
}

/**
 * The ONE function every reader of "what basis/period does this company use" calls - the settings
 * screen (to show the resolved value AND whether it is a default or an explicit choice) and the
 * cashed-revenue report (to pick its own default `granularity` when the request's own query param
 * omits one). Pure: `company` is already-fetched data, never a Prisma call of its own.
 */
export function resolveRevenueSettings(company: {
  revenueBasis?: string | null;
  revenuePeriod?: string | null;
  countryCode?: string | null;
}): ResolvedRevenueSettings {
  const explicitBasis = parseRevenueBasis(company.revenueBasis);
  const explicitPeriod = parseRevenuePeriod(company.revenuePeriod);
  const basisDefault = defaultRevenueBasisFor(company.countryCode);

  return {
    basis: explicitBasis ?? basisDefault.basis,
    period: explicitPeriod ?? 'monthly',
    basisIsExplicit: explicitBasis !== null,
    basisDefaultReason: basisDefault.reason,
    periodIsExplicit: explicitPeriod !== null,
  };
}

/** Validates a caller-supplied `revenueBasis`/`revenuePeriod` write - same "named 400, never a silent
 *  store-then-ignore" posture `normalizeDistanceSalesRegime` (company.service.ts) already holds for
 *  its own two-value column. `undefined` (key absent) leaves the column untouched; `null`/`''` clears
 *  it back to "use the computed default", a legitimate state to return to. */
export function normalizeRevenueBasis(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'invoiced' && normalized !== 'cashed') {
    throw new BadRequestException(
      `revenueBasis must be "invoiced" or "cashed" (or empty to use the default), not "${value}".`,
    );
  }
  return normalized;
}

export function normalizeRevenuePeriod(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'monthly' && normalized !== 'quarterly') {
    throw new BadRequestException(
      `revenuePeriod must be "monthly" or "quarterly" (or empty to use the default), not "${value}".`,
    );
  }
  return normalized;
}

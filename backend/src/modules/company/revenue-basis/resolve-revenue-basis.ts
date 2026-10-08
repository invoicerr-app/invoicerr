/**
 * A company's revenue basis (invoiced or cashed) and reporting period, defaulted from its country
 * when it has not chosen them. The country default lives in `policy.revenueBasisDefault` of the
 * country JSON; without one the basis stays "invoiced", the product's pre-existing behaviour
 * (dashboard totals already count by issue date). The company has no legal-form or regime field,
 * so a country default can only speak for that country's most common freelance regime.
 *
 * The period defaults to "monthly" as a design choice, not a legal one: a monthly view can be
 * aggregated into quarters, never the reverse.
 */

import { BadRequestException } from '@nestjs/common';
import { defaultCountryPolicyCatalog } from '@/modules/documents/country-policy/registry';
import { RevenueBasisDefaultFact } from '@/modules/documents/country-policy/schema';

export type RevenueBasis = RevenueBasisDefaultFact['basis'];
export type RevenuePeriod = 'monthly' | 'quarterly';

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
  /** Plain English, for the settings screen. */
  reason: string;
}

const FALLBACK_DEFAULT: RevenueBasisDefault = {
  basis: 'invoiced',
  reason:
    'No clear cashed-basis default found for this country - kept at "invoiced", this product’s own ' +
    'pre-existing behavior (dashboard totals already count by issue date).',
};

/** `countryCode` is compared case-insensitively and trimmed. */
export function defaultRevenueBasisFor(countryCode: string | null | undefined): RevenueBasisDefault {
  const fact = defaultCountryPolicyCatalog.revenueBasisDefaultFor((countryCode ?? '').trim());
  return fact ? { basis: fact.basis, reason: fact.reason } : FALLBACK_DEFAULT;
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

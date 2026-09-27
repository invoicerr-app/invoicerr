/**
 * Issue #496 - which number format a company's next document of a type is numbered with, and why.
 *
 * The owner's decision (2026-09-27): a number format is a compliance matter, defined per (country,
 * document type) in `country-policy/data/xx.json`'s `numberFormats`, and no company can change it.
 * There is exactly ONE exception, and it is not a preference either: a series a company ALREADY
 * started before this change keeps running under the format it was started with, because continuity
 * of an issued series is a legal obligation in every country this product covers (each country's own
 * `runningSeries` fact says why, with its source).
 *
 * `Company.numberFormats` therefore no longer holds settings. The migration
 * `20260928000000_issue_496_freeze_running_number_series` froze it into the list of RUNNING SERIES -
 * one entry per type the company had already numbered at least one document of, holding the pattern
 * that series was running under - and nothing writes it any more (`PUT /api/company/number-format`
 * refuses, `company.service.ts#updateNumberFormat`). A running series is honoured only while it
 * satisfies every constraint the country format itself satisfies: one that breaks them (FatturaPA's
 * 20 characters, say) gives way to the country format from the next number, and the counter goes on
 * without reset, so no issued number changes and no gap or duplicate appears.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import {
  constraintsFor,
  NumberFormatViolation,
  numberViolations,
  patternViolations,
} from '../country-policy/number-formats';
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from '../country-policy/registry';
import { NumberFormatConstraintFact, RunningSeriesPolicy } from '../country-policy/schema';

/** Where the pattern applied to the next number came from. */
export type NumberFormatSource = 'country-policy' | 'running-series';

export interface ResolvedNumberFormat {
  typeId: string;
  countryCode: string;
  /** The pattern the NEXT number of this type will be rendered with. */
  pattern: string;
  source: NumberFormatSource;
  /** The country's own format for this type - equal to `pattern` unless a running series is kept. */
  countryPattern: string;
  /** Every constraint binding this type in this country, with its provenance. */
  constraints: NumberFormatConstraintFact[];
  /** Present when no constraint binds this type: what was checked to say so. */
  unconstrained?: string;
  /** Why the country chose `countryPattern`. */
  rationale: string;
  runningSeries: RunningSeriesPolicy;
  /** Present when the company had a running series that breaks a constraint, and was therefore
   *  moved to the country format - the old pattern, and every rule it broke. */
  supersededRunningSeries?: { pattern: string; violations: NumberFormatViolation[] };
}

/** A company whose country has no `numberFormats` for this type cannot number it: there is no
 *  fallback format, the same "no permissive fallback" discipline country-policy.ts holds for actions.
 *  A 400, not a 500: the fix is a company setting (its country), never a code change. */
export class NumberFormatUnavailableError extends BadRequestException {}

/** Thrown inside the numbering transaction when a real, just-rendered number breaks a constraint (a
 *  counter that outgrew the worst case `patternViolations` judged the pattern against). The
 *  transaction rolls back, so no number is spent. */
export class NumberFormatViolationError extends BadRequestException {}

/**
 * Pure: resolves the format for `typeId` in `countryCode`, given the company's running series
 * (`Company.numberFormats`, frozen by the #496 migration). See this file's header for the rule.
 */
export function resolveNumberFormatFor(
  countryCode: string | undefined,
  typeId: string,
  runningSeries: Record<string, unknown> | null | undefined,
  catalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
): ResolvedNumberFormat {
  const formats = countryCode ? catalog.numberFormatsFor(countryCode) : undefined;
  const format = formats?.formats.find((f) => f.typeId === typeId);
  if (!countryCode || !formats || !format) {
    throw new NumberFormatUnavailableError(
      `No document number format is defined for "${typeId}" in ${countryCode ? `country "${countryCode}"` : 'this company (its country could not be resolved)'} - ` +
        'number formats are set per country and document type in ' +
        'backend/src/modules/documents/country-policy/data, never by the company. Set the company country first.',
    );
  }

  const constraints = constraintsFor(formats, format);
  const base: ResolvedNumberFormat = {
    typeId,
    countryCode,
    pattern: format.pattern,
    source: 'country-policy',
    countryPattern: format.pattern,
    constraints,
    unconstrained: format.unconstrained,
    rationale: format.rationale,
    runningSeries: formats.runningSeries,
  };

  const running = runningSeries?.[typeId];
  if (typeof running !== 'string' || running.length === 0 || running === format.pattern) return base;

  const violations = patternViolations(running, constraints);
  if (violations.length > 0) {
    return { ...base, supersededRunningSeries: { pattern: running, violations } };
  }
  return { ...base, pattern: running, source: 'running-series' };
}

/** Reads the company's country and running series, then resolves - the one entry point numbering
 *  (`take-number.ts`), the ATCUD gate (`actions/atcud-issuance.ts`) and the settings screen share. */
export async function resolveCompanyNumberFormat(
  companyId: string,
  typeId: string,
): Promise<ResolvedNumberFormat> {
  // ONE read for both facts. The country resolution is `country-policy.ts#resolveCompanyCountryCode`'s
  // own two lines (countryCode first, else the ISO code guessed from the free-text country), inlined
  // rather than called so the country and the running series come from the same row read.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { country: true, countryCode: true, numberFormats: true },
  });
  const countryCode =
    (company?.countryCode || guessCountryCode(company?.country ?? undefined) || '').trim().toUpperCase() ||
    undefined;
  return resolveNumberFormatFor(
    countryCode,
    typeId,
    company?.numberFormats as Record<string, unknown> | null,
  );
}

/** The check `numbering/sequence.ts` runs on the real number inside its transaction - see
 *  `NumberFormatViolationError`. */
export function assertNumberSatisfies(resolved: ResolvedNumberFormat): (displayNumber: string) => void {
  return (displayNumber) => {
    const violations = numberViolations(displayNumber, resolved.constraints);
    if (violations.length > 0) {
      throw new NumberFormatViolationError(
        `The next "${resolved.typeId}" number breaks a rule of country ${resolved.countryCode}: ` +
          `${violations.map((v) => `${v.message} (${v.constraintId})`).join('; ')}. ` +
          'Refused before it was issued; no number was spent.',
      );
    }
  };
}

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
 *
 * Issue #539 - the SAME continuity obligation decides what happens to a kept series at the 2027 yearly
 * reset (#515). Two options were on the table: (a) the series keeps counting continuously forever,
 * never reset, or (b) it is superseded by the country format from the switch point, the same way a
 * series that breaks a constraint already is. This module picks (a). (b) was rejected: superseding a
 * COMPLIANT series specifically because a feature shipped is exactly the outcome #496 exists to
 * prevent - a company that has been legally numbering "FAC-1", "FAC-2", ... would, overnight and with
 * no fault of its own, start printing a different prefix AND restart at 1, which is no more continuous
 * than the duplicate it would otherwise have produced, and strictly worse than doing nothing (a kept
 * series is never REQUIRED to restart - `reset: "yearly"` on the country format only ever means the
 * COUNTRY's own default pattern may restart, never that every invoice number in that country must). So
 * a kept running series without a `{year}` token simply never restarts: `reset: "never"`, whatever the
 * country format's own reset says - see `resolveNumberFormatFor` below.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import {
  constraintsFor,
  HAS_YEAR_TOKEN,
  NumberFormatViolation,
  numberViolations,
  patternViolations,
} from '../country-policy/number-formats';
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from '../country-policy/registry';
import { NumberFormatConstraintFact, PolicyProvenance, RunningSeriesPolicy } from '../country-policy/schema';

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
  /** Issue #515 - whether this type's counter may restart at 1 on every 1 January, in this country.
   *  Read off the COUNTRY's own format for `typeId` for a company with no running series, or one whose
   *  running series itself prints a year: a running series is normally just a different printed prefix
   *  for the same legal document type, so it shares the same reset rule the country format carries
   *  (`periodKeyFor` below reads this field, never the format string, to decide which counter row a
   *  document lands on).
   *  Issue #539 - the one exception: a kept running series whose pattern carries NO `{year}` token can
   *  never inherit a `'yearly'` country reset, whatever the country format says - opening a fresh,
   *  year-keyed row would render a number that series already issued a second time (e.g. "FAC-1"
   *  again), a duplicate that is a legal fault in every country this catalog covers. Such a series
   *  stays `'never'` here, forever - see this file's own header for why continuity was chosen over
   *  superseding the series by the country format at the switch point. */
  reset: 'yearly' | 'never';
  /** Why THIS reset rule - see `schema.ts#DocumentNumberFormatFact.resetProvenance`'s own header. */
  resetProvenance: PolicyProvenance;
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
    reset: format.reset,
    resetProvenance: format.resetProvenance,
  };

  const running = runningSeries?.[typeId];
  if (typeof running !== 'string' || running.length === 0 || running === format.pattern) return base;

  const violations = patternViolations(running, constraints);
  if (violations.length > 0) {
    return { ...base, supersededRunningSeries: { pattern: running, violations } };
  }

  // Issue #539 - `base.reset` above is the COUNTRY format's own reset rule, and a kept series that
  // itself prints a year is content to share it (that is exactly what #515 intends: such a series
  // restarts too). But `assertValidNumberFormats`'s own "yearly needs {year}" gate
  // (`country-policy/number-formats.ts`) only ever checked the country's SHIPPED pattern - it has never
  // seen a company's running series, which is composed here, at request time, not at catalog load time.
  // A kept series with no `{year}` token inheriting a `'yearly'` reset would open a fresh, year-keyed
  // counter row on 1 January 2027 while still printing the SAME string it always has, so the very first
  // number of the new row (e.g. "FAC-1") would collide with a number this series already issued years
  // ago - the exact duplicate this file's own header explains why #539 refuses to allow. So the reset
  // is forced to `'never'` here, unconditionally, whatever the country format says - see this file's
  // header for why continuity (never restart) was chosen over superseding the series by the country
  // format at the switch point. `resetProvenance` is not re-derived: it is the SAME per-country
  // continuity obligation (`runningSeries.provenance`) that already justifies keeping this series'
  // pattern unchanged in the first place - a kept series never restarting is that same obligation
  // applied to the one moment (a calendar year turning over) where restarting would otherwise happen.
  if (format.reset === 'yearly' && !HAS_YEAR_TOKEN.test(running)) {
    return {
      ...base,
      pattern: running,
      source: 'running-series',
      reset: 'never',
      resetProvenance: formats.runningSeries.provenance,
    };
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

/**
 * Issue #515 - the first calendar year a `reset: "yearly"` format's counter may key by. Numbers
 * already issued never change: the counter every type used BEFORE this feature (`year = 0` on
 * `DocumentNumberSequence`) goes on exactly where it stood for any document dated before this year,
 * and only a document dated on or after it ever opens a fresh, year-keyed row. This is the owner's
 * own decision on #515 (the restart applies "from the first document dated 2027-01-01 or later") -
 * not "whenever this feature happens to ship" - so it is a fixed constant, never `new Date()`.
 */
export const YEARLY_RESET_STARTS_FROM_YEAR = 2027;

/**
 * The document's own issue date - the ONLY thing a `reset: "yearly"` counter may be keyed by, never
 * the server clock the numbering call happens to run at (issue #515: "the year taken from the
 * document's own issue date, not the server clock"). `data` is whatever the caller already has in
 * hand (a `DocumentInstanceResult.data`, or the `data` about to be written in the same transaction -
 * both `unknown`, since this module has no opinion on a document type's own field shape); every
 * numbered type but `goods-receipt` declares an `issueDate` field
 * (descriptors/*.descriptor.ts), and `goods-receipt` numbers no country-constrained type
 * (`reset` is always `'never'` for it - see `data/xx.json`'s own `unconstrained` statements), so it
 * never actually needs this value to be anything but the fallback below. A missing or unparseable
 * value falls back to the moment of numbering - the same "moment the number was taken" posture
 * `format-number.ts`'s own header already documents for a document with no more specific date to
 * offer.
 */
export function issuedAtFrom(data: unknown): Date {
  const raw = (data as Record<string, unknown> | null | undefined)?.issueDate;
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * The `DocumentNumberSequence` row this document's number is taken from - `0` for a `reset: "never"`
 * format, or for a `reset: "yearly"` document dated before `YEARLY_RESET_STARTS_FROM_YEAR` (the "a
 * document dated 31 December but numbered in January belongs to the old year" case issue #515 names
 * explicitly: such a document keeps using the SAME row its year's other documents already do,
 * whether that row is `0`, the pre-#515 continuous counter, or an earlier `reset: "yearly"` year that
 * already started); the document's own ISSUE year otherwise, so every later calendar year opens its
 * own fresh row at 1, never touching another year's.
 */
export function periodKeyFor(resolved: Pick<ResolvedNumberFormat, 'reset'>, issuedAt: Date): number {
  if (resolved.reset !== 'yearly') return 0;
  const year = issuedAt.getFullYear();
  return year >= YEARLY_RESET_STARTS_FROM_YEAR ? year : 0;
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

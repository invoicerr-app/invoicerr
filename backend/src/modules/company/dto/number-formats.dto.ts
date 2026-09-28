/**
 * The response of `GET /api/company/number-formats` (issue #496) - the read-only settings card. Every
 * string meant for a human is plain English data from `documents/country-policy/data/xx.json`, shown
 * verbatim, the same convention `country-policy.ts`'s refusal reasons already follow.
 */
import { PolicyProvenance, RunningSeriesPolicy } from '@/modules/documents/country-policy/schema';
import { NumberFormatViolation } from '@/modules/documents/country-policy/number-formats';
import { NumberFormatSource } from '@/modules/documents/numbering/company-number-format';

export interface CompanyNumberFormatConstraint {
  id: string;
  summary: string;
  maxLength: number | null;
  provenance: PolicyProvenance;
}

export interface CompanyNumberFormat {
  typeId: string;
  /** The pattern the next number of this type is rendered with. */
  pattern: string;
  source: NumberFormatSource;
  /** The country's own format - differs from `pattern` only for a kept running series. */
  countryPattern: string;
  /** The value the counter hands out next (1 for a type never numbered). */
  nextNumber: number;
  /** `pattern` rendered with `nextNumber` and today's date - what the next document would print. */
  nextDisplayNumber: string;
  rationale: string;
  unconstrained: string | null;
  supersededRunningSeries: { pattern: string; violations: NumberFormatViolation[] } | null;
  constraints: CompanyNumberFormatConstraint[];
}

export interface CompanyNumberFormats {
  countryCode: string | null;
  runningSeries: RunningSeriesPolicy | null;
  formats: CompanyNumberFormat[];
  /** Set when no format applies (no country, or a country without a catalog) - why. */
  unavailableReason: string | null;
}

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
  /** The value the counter hands out next (1 for a type never numbered, or for the first document of
   *  a `reset: "yearly"` counter's period - issue #515: read from the row a document ISSUED TODAY
   *  would land on, `numbering/company-number-format.ts#periodKeyFor`). */
  nextNumber: number;
  /** `pattern` rendered with `nextNumber` and today's date - what the next document would print. */
  nextDisplayNumber: string;
  rationale: string;
  unconstrained: string | null;
  supersededRunningSeries: { pattern: string; violations: NumberFormatViolation[] } | null;
  constraints: CompanyNumberFormatConstraint[];
  /** Issue #515 - whether this type's counter may restart at 1 on every 1 January, in this country. */
  reset: 'yearly' | 'never';
  /** Why THIS reset rule - see `country-policy/schema.ts#DocumentNumberFormatFact.resetProvenance`. */
  resetProvenance: PolicyProvenance;
}

export interface CompanyNumberFormats {
  countryCode: string | null;
  runningSeries: RunningSeriesPolicy | null;
  formats: CompanyNumberFormat[];
  /** Set when no format applies (no country, or a country without a catalog) - why. */
  unavailableReason: string | null;
}

/**
 * "Declare your last number issued" (issue #340) - `numbering/declare-last-number.ts` and
 * `company.service.ts#declareLastNumberIssued`, usable with or without also importing a document.
 */
export interface DeclareLastNumberInferRequest {
  typeId: string;
  lastNumber: string;
  /** ISO date (YYYY-MM-DD) - the date the previous tool issued `lastNumber` on. */
  lastIssueDate: string;
}

export interface DeclareLastNumberInferResponse {
  /** `undefined` when no pattern could be inferred at all (the example has no digits) - the company
   *  then types one in by hand; the field stays editable either way. */
  pattern: string | null;
}

export interface DeclareLastNumberRequest extends DeclareLastNumberInferRequest {
  /** The pattern the company confirmed (or typed) - re-verified server-side against `lastNumber`
   *  before anything is written, never trusted blindly. */
  pattern: string;
}

export interface DeclareLastNumberResponse {
  typeId: string;
  /** The pattern that will actually be used going forward. */
  pattern: string;
  source: NumberFormatSource;
  /** The counter's own next value (`lastNumber`'s own sequential value + 1). */
  nextNumber: number;
  /** Why the declared pattern did NOT become the running series - `null` when it did. */
  violations: NumberFormatViolation[] | null;
  /** Portugal only - the ATCUD series identifier this company must register with the AT
   *  (`PUT /api/company/atcud-series`) before its first document of this type. `null` everywhere
   *  else, where a running series carries no ATCUD concept at all. */
  atcudSeriesToRegister: string | null;
}

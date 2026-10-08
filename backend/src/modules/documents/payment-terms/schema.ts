/**
 * The country catalog format for one narrow fact: the longest payment term the country's law lets
 * two businesses agree on, counted from the invoice's issue date. A country with no `paymentTerms`
 * section has no known cap and nothing is ever warned about for it.
 *
 * Reuses `country-policy/schema.ts`'s provenance union, like every sibling catalog.
 */
import {
  assertValidPolicyProvenance,
  InvalidPolicyProvenanceError,
  PolicyProvenance,
} from '../country-policy/schema';

export interface CountryPaymentTermsFile {
  /** ISO 3166-1 alpha-2, uppercase, must match the file's own name (`countries/data/all.ts` checks it). */
  countryCode: string;
  /** Longest agreed term in calendar days after the issue date ("net"). */
  maxNetDays: number;
  /** Longest agreed term in days after the issue date when it is counted to the end of that month. */
  maxEndOfMonthDays: number;
  provenance: PolicyProvenance;
  notes?: string;
}

export class InvalidPaymentTermsError extends InvalidPolicyProvenanceError {}

function assertPositiveInteger(value: unknown, field: string, context: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new InvalidPaymentTermsError(`${context}: "${field}" must be a positive integer.`);
  }
}

export function assertValidPaymentTerms(file: CountryPaymentTermsFile, context: string): void {
  assertPositiveInteger(file.maxNetDays, 'maxNetDays', context);
  assertPositiveInteger(file.maxEndOfMonthDays, 'maxEndOfMonthDays', context);
  assertValidPolicyProvenance(file.provenance, `${context} paymentTerms`, 'a payment-term cap');
}

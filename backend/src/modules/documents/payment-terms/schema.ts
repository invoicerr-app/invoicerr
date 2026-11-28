/**
 * The country catalog format for two payment-term facts, each optional:
 *  - the longest term the country's law lets two businesses agree on, counted from the invoice's
 *    issue date (a country without one is never warned about);
 *  - the fallback term the application uses to prefill an invoice's due date when the company has
 *    no default of its own. No shipped country sets a payment term by statute: `basis` says what the
 *    quoted text actually provides the 30 days for.
 *
 * Reuses `country-policy/schema.ts`'s provenance union, like every sibling catalog.
 */
import {
  assertValidPolicyProvenance,
  InvalidPolicyProvenanceError,
  PolicyProvenance,
} from '../country-policy/schema';

/**
 * - `latePaymentThreshold`: the statute says when the debtor is late or interest starts to run.
 * - `maximumWhenNotAgreed`: the statute caps the payment period when nothing was agreed.
 */
const FALLBACK_TERM_BASES = ['latePaymentThreshold', 'maximumWhenNotAgreed'] as const;
export type FallbackTermBasis = (typeof FALLBACK_TERM_BASES)[number];

export interface CountryFallbackPaymentTerm {
  /** Calendar days after the invoice date. */
  days: number;
  basis: FallbackTermBasis;
  provenance: PolicyProvenance;
  notes?: string;
}

export interface CountryPaymentTermsFile {
  /** ISO 3166-1 alpha-2, uppercase, must match the file's own name (`countries/data/all.ts` checks it). */
  countryCode: string;
  /** Longest agreed term in calendar days after the issue date ("net"). */
  maxNetDays?: number;
  /** Longest agreed term in days after the issue date when it is counted to the end of that month. */
  maxEndOfMonthDays?: number;
  /** Source of the two caps above. */
  provenance?: PolicyProvenance;
  fallbackTerm?: CountryFallbackPaymentTerm;
  notes?: string;
}

class InvalidPaymentTermsError extends InvalidPolicyProvenanceError {}

function assertPositiveInteger(value: unknown, field: string, context: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new InvalidPaymentTermsError(`${context}: "${field}" must be a positive integer.`);
  }
}

export function hasPaymentTermCap(file: CountryPaymentTermsFile): boolean {
  return (
    file.maxNetDays !== undefined || file.maxEndOfMonthDays !== undefined || file.provenance !== undefined
  );
}

export function assertValidPaymentTerms(file: CountryPaymentTermsFile, context: string): void {
  if (!hasPaymentTermCap(file) && !file.fallbackTerm) {
    throw new InvalidPaymentTermsError(
      `${context}: declares neither a payment-term cap nor a fallback term.`,
    );
  }
  if (hasPaymentTermCap(file)) {
    assertPositiveInteger(file.maxNetDays, 'maxNetDays', context);
    assertPositiveInteger(file.maxEndOfMonthDays, 'maxEndOfMonthDays', context);
    assertValidPolicyProvenance(
      file.provenance as PolicyProvenance,
      `${context} paymentTerms`,
      'a payment-term cap',
    );
  }
  if (file.fallbackTerm) {
    assertPositiveInteger(file.fallbackTerm.days, 'fallbackTerm.days', context);
    if (!FALLBACK_TERM_BASES.includes(file.fallbackTerm.basis)) {
      throw new InvalidPaymentTermsError(
        `${context}: "fallbackTerm.basis" must be one of ${FALLBACK_TERM_BASES.join(', ')}.`,
      );
    }
    assertValidPolicyProvenance(
      file.fallbackTerm.provenance,
      `${context} paymentTerms.fallbackTerm`,
      'a fallback payment term',
    );
  }
}

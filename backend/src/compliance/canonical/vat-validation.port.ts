/**
 * C4 — the seam that decides whether a VAT number has been VERIFIED, not merely typed.
 *
 * The defect this exists to fix: `invoice-tax.ts` hardcoded `validated: false as const`, and
 * `TrustFlagVatValidator` only unlocks reverse charge for `validated === true`. From the invoice
 * path no VAT number was ever validated, so an intra-EU B2B service came out at 20% French VAT
 * instead of reverse-charged (Directive 2006/112 art. 44, CGI art. 259-1°) — a tax the customer
 * does not owe, on an invoice whose VAT category is wrong.
 *
 * The hardcoded `false` was not an oversight. Its comment explains it: trusting a free-text VAT
 * field would let anyone type a fake number and get 0%, an UNDER-charge. Replacing it with `true`
 * would trade one error for the other. The fix is neither — it is knowing, per identifier, whether
 * the number was actually checked.
 *
 * Injectable for the same reason the rendering port is: a real deployment talks to VIES, tests do
 * not, and a suite that cannot exercise the unavailable case cannot prove the product behaves when
 * the European Commission's service is down — which it regularly is.
 */

/**
 * Three outcomes, and the third is not a failure mode to be collapsed into the second.
 *
 *   VALID        the member state confirmed the number
 *   INVALID      the member state denied it — the number is wrong
 *   UNAVAILABLE  we could not ask (service down, member state saturated, timeout, not an EU number)
 *
 * INVALID and UNAVAILABLE must never be merged: one says the customer's number is wrong, the other
 * says we do not know. They call for different words to the user and, arguably, different VAT.
 */
export type VatValidationStatus = 'VALID' | 'INVALID' | 'UNAVAILABLE';

export interface VatValidationResult {
  status: VatValidationStatus;
  /** When this verdict was obtained. A stored "valid" without a date is not a fact. */
  checkedAt: Date;
  /** Which service answered, so a stored verdict can be attributed and re-checked. */
  source: string;
}

export interface VatValidationPort {
  /**
   * Never throws. A transport failure is an `UNAVAILABLE` verdict, not an exception: validating a
   * VAT number is not allowed to be the thing that stops an invoice being issued, and a caller that
   * has to wrap this in try/catch will eventually get the catch wrong.
   */
  validate(countryCode: string, vatNumber: string): Promise<VatValidationResult>;
}

/**
 * The default for any context without a real one: it never claims a number is valid.
 *
 * That preserves today's conservative behaviour exactly — an unverified number does not unlock
 * reverse charge — while making the REASON visible. `UNAVAILABLE` says "not checked"; the previous
 * hardcoded `false` said "checked and not valid", which was never true.
 */
export class NullVatValidationClient implements VatValidationPort {
  async validate(): Promise<VatValidationResult> {
    return { status: 'UNAVAILABLE', checkedAt: new Date(), source: 'none' };
  }
}

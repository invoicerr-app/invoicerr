/**
 * Decides whether — and in what shape — this company's own VAT number is safe to hand to Polar as
 * `customerTaxId` on a checkout. Real dev-instance incident, 2026-09-16: `Company.exemptVat = true`
 * (a French micro-entreprise under "franchise en base", CGI art. 293 B) with `PartyIdentifier`
 * VAT `FR54982187676` — a CHECKSUM-VALID key (SIREN 982187676 mod 97 = 14, (12 + 3×14) mod 97 = 54) —
 * still made Polar's sandbox checkout answer "The provided tax ID is invalid." Polar's own tax-id
 * field is validated against VIES (the EU's live VAT-registration lookup), not just parsed for shape:
 * a franchise-en-base trader is by definition NOT VAT-registered, so it has no active VIES entry to
 * match against, no matter how well-formed the number looks — see `checkout-session.ts`'s own header
 * for the sandbox retry this fact drives, and `checkout-session.spec.ts` for the reproduction.
 *
 * Two independent, INDEPENDENT-OF-POLAR gates decide whether this module even ATTEMPTS to send a tax
 * id — VIES itself is Polar's problem to answer, not this function's:
 *
 *  1. `Company.exemptVat` — never sent at all. Every VAT-exempt company already tells this app it has
 *     no active VAT registration (`tax/load-and-resolve.ts`'s own `FRANCHISE_BASE` mapping reads the
 *     exact same field); handing Polar a tax id it can only ever reject for such a company is a
 *     guaranteed round-trip for nothing.
 *  2. Offline FORMAT syntax, via `tax/vat-syntax.ts#validateVat` — the SAME per-country checksum this
 *     app already trusts as the sole authority on VAT syntax (`country-identifiers/validate-identifier-
 *     value.ts`'s own header: "ownership of VAT syntax stays exclusively with vat-syntax.ts"). A bare
 *     SIREN ("982187676", no "FR" prefix) or any other non-VAT value stored in the same
 *     `PartyIdentifier` row is never handed to Polar as a tax id — Polar has no chance to accept it
 *     either way, and "structural garbage" is a fact this app can already establish for free, offline.
 *
 * A number that PASSES both gates can still be refused by Polar/VIES (this file's own header case) —
 * that is `createCheckoutSession`'s own retry-without-tax-id to handle, never this function's.
 */
import { validateVat } from '@/modules/documents/tax/vat-syntax';

export interface ResolveCheckoutTaxIdParams {
  /** The raw `PartyIdentifier` VAT value on file for this company, if any. */
  rawVatNumber: string | null;
  /** The company's own ISO alpha-2 country code — the hint `validateVat` dispatches on; falls back to
   *  the value's own two-letter prefix when absent, same as `validateVat` does for every other caller. */
  countryCode: string | null;
  /** `Company.exemptVat` — see gate 1 above. */
  exemptVat: boolean;
}

/**
 * `null` whenever either gate fails — the checkout then omits `customerTaxId` entirely and Polar's own
 * hosted form asks the buyer for it directly if it actually needs one. Otherwise returns the value
 * cleaned (whitespace/dashes stripped, upper-cased) exactly the way `validateVat` itself normalizes it
 * before checking the checksum, so what gets sent is what was actually validated.
 */
export function resolveCheckoutTaxId({
  rawVatNumber,
  countryCode,
  exemptVat,
}: ResolveCheckoutTaxIdParams): string | null {
  if (exemptVat) return null;
  if (!rawVatNumber) return null;

  const clean = rawVatNumber.replace(/[\s-]/g, '').toUpperCase();
  if (!clean) return null;

  const result = validateVat(clean, countryCode ?? undefined);
  return result.valid ? clean : null;
}

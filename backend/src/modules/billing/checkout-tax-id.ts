/**
 * Decides whether this company's VAT number is safe to send to Polar as `customerTaxId`. Polar checks
 * tax ids against VIES, so a checksum-valid number from a VAT-exempt (franchise en base) company, which
 * has no VIES entry, is still rejected. We therefore skip VAT-exempt companies and values that fail
 * offline syntax (`validateVat`); a number passing both can still be refused, which
 * `createCheckoutSession` handles by retrying without a tax id.
 */
import { validateVat } from '@/modules/documents/tax/vat-syntax';

export interface ResolveCheckoutTaxIdParams {
  rawVatNumber: string | null;
  /** Hint for `validateVat`; when absent it falls back to the value's two-letter prefix. */
  countryCode: string | null;
  exemptVat: boolean;
}

/**
 * `null` when a gate fails, letting Polar's hosted form ask for the tax id. Otherwise returns the value
 * normalized the same way `validateVat` does, so what is sent is what was validated.
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

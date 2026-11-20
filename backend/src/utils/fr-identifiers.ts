/**
 * French company identifiers (SIRET, SIREN, intra-community VAT key), validated offline.
 *
 * Lives in `utils/` rather than in `modules/sirene/` so that `company-lookup` can use it without
 * importing the `sirene` module, which itself imports `company-lookup` (`sirene.service.ts`).
 * `modules/sirene/sirene.utils.ts` re-exports it for existing callers.
 */

/**
 * Standard Luhn sum: every second digit from the right is doubled (minus 9 above 9). A string of
 * digits is valid when the result is a multiple of 10. INSEE uses it for both SIREN and SIRET.
 */
export function luhnSum(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum;
}

export function formatSiret(siret: string): string {
  return siret.replace(/[^0-9]/g, '');
}

export function isValidSiret(siret: string): boolean {
  const formatted = formatSiret(siret);
  if (formatted.length !== 14) return false;
  return luhnSum(formatted) % 10 === 0;
}

export function calculateFrenchVAT(siren: string): string {
  const key = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
  return `FR${key.toString().padStart(2, '0')}${siren}`;
}

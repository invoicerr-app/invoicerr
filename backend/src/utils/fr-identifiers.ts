/**
 * French company identifiers (SIRET, SIREN, intra-community VAT key), validated offline.
 *
 * Lives in `utils/` rather than in `modules/sirene/` so that `company-lookup` can use it without
 * importing the `sirene` module, which itself imports `company-lookup` (`sirene.service.ts`).
 * `modules/sirene/sirene.utils.ts` re-exports it for existing callers.
 */

/**
 * Standard Luhn check: every second digit from the right is doubled (minus 9 above 9), and the
 * digits are valid when the sum is a multiple of 10. INSEE uses it for both SIREN and SIRET.
 *
 * The loop is bounded by the fixed identifier length (9 or 14), never by the input's own length,
 * as the inline loops it replaces were: the input comes from user requests (CodeQL
 * js/loop-bound-injection).
 */
export function isLuhnValid(digits: string, length: 9 | 14): boolean {
  if (digits.length !== length) return false;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    let digit = parseInt(digits[length - 1 - i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function formatSiret(siret: string): string {
  return siret.replace(/[^0-9]/g, '');
}

export function isValidSiret(siret: string): boolean {
  const formatted = formatSiret(siret);
  return isLuhnValid(formatted, 14);
}

export function calculateFrenchVAT(siren: string): string {
  const key = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
  return `FR${key.toString().padStart(2, '0')}${siren}`;
}

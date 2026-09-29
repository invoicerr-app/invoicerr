/**
 * Forward generators for every checksummed national identifier the demo seed needs — one per
 * supported country (FR/DE/IT/PL/PT), each a MIRROR of this codebase's own OFFLINE validator so a
 * generated value is guaranteed to pass it:
 *
 *  - FR (SIRET + intra-EU VAT): `modules/sirene/sirene.utils.ts#isValidSiret`/`calculateFrenchVAT`.
 *  - DE (USt-IdNr): `modules/documents/tax/vat-syntax.ts#validateDeVat` (ISO 7064 Mod 11,10).
 *  - IT (Partita IVA): `vat-syntax.ts#validateItVat` (Luhn-like).
 *  - PL (NIP): `vat-syntax.ts#validateNip` (weighted mod 11).
 *  - PT (NIF/NIPC): no validator exists ANYWHERE in this codebase (confirmed by research before this
 *    file was written — `country-identifiers/validate-identifier-value.ts` skips the checksum for
 *    every scheme but the pattern regex, and `vat-syntax.ts`'s own dispatcher falls to a
 *    structural-only default for PT). `validatePtNif` below implements the standard, published
 *    Módulo 11 algorithm directly and is the only thing in this codebase (or, until now, this
 *    project's own research) that checks a PT NIF's checksum at all — `demo-mode-seed.spec.ts` proves
 *    generator and validator agree with each other, which is the strongest claim available with no
 *    third, independent implementation to cross-check against.
 *
 * `demo-mode-seed.spec.ts` runs every generator below against several seeds and asserts the result
 * passes the matching REAL validator (FR/DE/IT/PL) or this file's own `validatePtNif` (PT) — the test
 * issue #533 asked for: "runs the seed with several seeds and checks every country's documents
 * validate".
 */
import { calculateFrenchVAT, isValidSiret } from '@/modules/sirene/sirene.utils';
import { validateDeVat, validateFrVat, validateItVat, validateNip } from '@/modules/documents/tax/vat-syntax';

import { Rng, intBetween } from './rng';

function randomDigits(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => intBetween(rng, 0, 9));
}

function digitsToString(digits: number[]): string {
  return digits.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// France — SIRET (14 digits, Luhn on even 0-based positions) + intra-EU VAT (derived from the SIREN)
// ─────────────────────────────────────────────────────────────────────────────

export interface FrIdentifiers {
  siret: string;
  siren: string;
  vat: string;
}

export function generateFrIdentifiers(rng: Rng): FrIdentifiers {
  // Build the first 13 digits at random, then solve the 14th (an odd 0-based position, never
  // doubled — `isValidSiret`'s own loop) so the FULL 14-digit Luhn sum is a multiple of 10.
  const first13 = randomDigits(rng, 13);
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = first13[i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  const siret = digitsToString([...first13, checkDigit]);
  const siren = siret.slice(0, 9);
  const vat = calculateFrenchVAT(siren);
  return { siret, siren, vat };
}

export function assertValidFrIdentifiers({ siret, vat }: FrIdentifiers): void {
  if (!isValidSiret(siret)) throw new Error(`Generated an invalid FR SIRET: ${siret}`);
  const result = validateFrVat(vat);
  if (!result.valid) throw new Error(`Generated an invalid FR VAT number: ${vat} (${result.reason})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Germany — USt-IdNr, DE + 9 digits, ISO 7064 Mod 11,10 (mirrors `validateDeVat`'s own loop)
// ─────────────────────────────────────────────────────────────────────────────

export function generateDeVat(rng: Rng): string {
  const digits = randomDigits(rng, 8);
  let p = 10;
  for (let i = 0; i < 8; i++) {
    let s = (digits[i] + p) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }
  const checkDigit = 11 - p === 10 ? 0 : 11 - p;
  return `DE${digitsToString([...digits, checkDigit])}`;
}

export function assertValidDeVat(vat: string): void {
  const result = validateDeVat(vat);
  if (!result.valid) throw new Error(`Generated an invalid DE VAT number: ${vat} (${result.reason})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Italy — Partita IVA, 11 digits, Luhn-like (mirrors `validateItVat`'s own loop)
// ─────────────────────────────────────────────────────────────────────────────

export function generateItPartitaIva(rng: Rng): string {
  const digits = randomDigits(rng, 10);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < 10; i++) {
    const d = digits[i];
    if (i % 2 === 0) {
      s1 += d;
    } else {
      const dbl = d * 2;
      s2 += dbl > 9 ? dbl - 9 : dbl;
    }
  }
  const checkDigit = (10 - ((s1 + s2) % 10)) % 10;
  return digitsToString([...digits, checkDigit]);
}

export function assertValidItPartitaIva(value: string): void {
  const result = validateItVat(value);
  if (!result.valid) throw new Error(`Generated an invalid IT Partita IVA: ${value} (${result.reason})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Poland — NIP, 10 digits, weighted mod 11 (mirrors `validateNip`'s own weights)
// ─────────────────────────────────────────────────────────────────────────────

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function generatePlNip(rng: Rng): string {
  for (;;) {
    const digits = randomDigits(rng, 9);
    const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
    const check = sum % 11;
    // check === 10 is a reserved, never-valid NIP (`validateNip`'s own refusal) — redraw rather than
    // emit a value the real validator would reject.
    if (check === 10) continue;
    return digitsToString([...digits, check]);
  }
}

export function assertValidPlNip(value: string): void {
  const result = validateNip(value);
  if (!result.valid) throw new Error(`Generated an invalid PL NIP: ${value} (${result.reason})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Portugal — NIF/NIPC, 9 digits, standard Módulo 11 (no validator exists in this codebase — see this
// file's own header). First digit fixed to '5' (sociedade anónima / company), the documented
// convention for a Portuguese legal-entity NIF.
// ─────────────────────────────────────────────────────────────────────────────

const PT_NIF_WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 2] as const;

function ptNifCheckDigit(first8: number[]): number {
  const sum = PT_NIF_WEIGHTS.reduce((acc, w, i) => acc + w * first8[i], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function generatePtNif(rng: Rng): string {
  const first8 = [5, ...randomDigits(rng, 7)];
  const checkDigit = ptNifCheckDigit(first8);
  return digitsToString([...first8, checkDigit]);
}

/** Standalone, since no reference validator exists to reuse — the SAME formula `generatePtNif` above
 *  uses to compute the check digit it emits, run in the reverse (verifying) direction. */
export function validatePtNif(value: string): { valid: boolean; reason?: string } {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(clean)) {
    return { valid: false, reason: 'PT NIF must be exactly 9 digits' };
  }
  const digits = clean.split('').map(Number);
  const expected = ptNifCheckDigit(digits.slice(0, 8));
  return expected === digits[8] ? { valid: true } : { valid: false, reason: 'PT NIF checksum mismatch' };
}

export function assertValidPtNif(value: string): void {
  const result = validatePtNif(value);
  if (!result.valid) throw new Error(`Generated an invalid PT NIF: ${value} (${result.reason})`);
}

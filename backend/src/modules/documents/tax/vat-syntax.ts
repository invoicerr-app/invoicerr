/**
 * Pure, offline VAT-number SYNTAX validators — REPRISE quasi verbatim of the `validateVat` dispatcher
 * and its per-country checksum functions from `compliance/canonical/identifier-validator.ts` (git
 * tag `avant-refonte-documents`). Only the SIREN/SIRET/Codice-Fiscale/RFC validators were dropped —
 * this module cares only about VAT numbers (root TODO item 16's own "syntaxique par pays" contract);
 * `validateNip` is kept because the repère's own `validateVat` calls it internally for PL.
 *
 * No network I/O. Each algorithm cites its authoritative reference, copied from the repère.
 *
 * References
 *  NIP (PL)    : https://pl.wikipedia.org/wiki/Numer_identyfikacji_podatkowej
 *  FR VAT      : https://fr.wikipedia.org/wiki/Num%C3%A9ro_de_TVA_intracommunautaire#France
 *  IT P.IVA    : https://it.wikipedia.org/wiki/Partita_IVA_(Italia)
 *  DE VAT      : ISO 7064 Mod 11,10 — https://en.wikipedia.org/wiki/VAT_identification_number#Germany
 *  ES VAT/NIF  : https://en.wikipedia.org/wiki/VAT_identification_number#Spain
 *
 * `resolve-invoice-tax.ts` is the consumer that turns `valid: false` into "treat this buyer as B2C,
 * with a named warning — never a silent B2B" (root TODO item 16, "un numéro TVA invalide
 * syntaxiquement → l'acheteur est B2C").
 */

export interface IdentifierValidationResult {
  scheme: string;
  value: string;
  valid: boolean;
  reason?: string;
  checksumValidated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// NIP (PL) — 10 digits, weighted checksum mod 11
// ─────────────────────────────────────────────────────────────────────────────

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function validateNip(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) {
    return {
      scheme: 'NIP',
      value,
      valid: false,
      reason: 'Must be exactly 10 digits',
      checksumValidated: false,
    };
  }
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * parseInt(clean[i], 10), 0);
  const check = sum % 11;
  if (check === 10) {
    return {
      scheme: 'NIP',
      value,
      valid: false,
      reason: 'Check digit 10 is reserved (invalid NIP)',
      checksumValidated: true,
    };
  }
  const valid = check === parseInt(clean[9], 10);
  return {
    scheme: 'NIP',
    value,
    valid,
    reason: valid ? undefined : 'NIP weighted checksum failed',
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// French VAT (TVA intracommunautaire) — FR + 2-char key + 9-digit SIREN
// clé = (12 + 3 × (SIREN mod 97)) mod 97
// ─────────────────────────────────────────────────────────────────────────────

const FR_VAT_B34 = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 34 chars, excludes I and O

function frVatCharVal(c: string): number {
  return FR_VAT_B34.indexOf(c);
}

export function validateFrVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^FR[0-9A-HJ-NP-Z]{2}\d{9}$/.test(clean)) {
    return {
      scheme: 'VAT',
      value,
      valid: false,
      reason: 'FR VAT: expected FRxx + 9 digits (x = digit or uppercase letter ≠ I/O)',
      checksumValidated: false,
    };
  }
  const key = clean.slice(2, 4);
  const siren = clean.slice(4);
  const expected = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;

  if (/^\d{2}$/.test(key)) {
    const actual = parseInt(key, 10);
    const valid = actual === expected;
    return {
      scheme: 'VAT',
      value,
      valid,
      reason: valid
        ? undefined
        : `FR VAT key mismatch (expected ${String(expected).padStart(2, '0')}, got ${key})`,
      checksumValidated: true,
    };
  }

  const actual = frVatCharVal(key[0]) * 34 + frVatCharVal(key[1]);
  const valid = actual === expected;
  return {
    scheme: 'VAT',
    value,
    valid,
    reason: valid ? undefined : `FR VAT alpha key mismatch (base-34 value ${actual} ≠ expected ${expected})`,
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Italian Partita IVA — 11 digits, Luhn-like
// ─────────────────────────────────────────────────────────────────────────────

export function validateItVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(clean)) {
    return {
      scheme: 'VAT',
      value,
      valid: false,
      reason: 'IT Partita IVA must be exactly 11 digits',
      checksumValidated: false,
    };
  }
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < 10; i++) {
    const d = parseInt(clean[i], 10);
    if (i % 2 === 0) {
      s1 += d;
    } else {
      const dbl = d * 2;
      s2 += dbl > 9 ? dbl - 9 : dbl;
    }
  }
  const expected = (10 - ((s1 + s2) % 10)) % 10;
  const valid = expected === parseInt(clean[10], 10);
  return {
    scheme: 'VAT',
    value,
    valid,
    reason: valid ? undefined : 'IT P.IVA checksum failed',
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// German VAT (Umsatzsteuer-Identifikationsnummer) — DE + 9 digits, ISO 7064 Mod 11,10
// ─────────────────────────────────────────────────────────────────────────────

export function validateDeVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^DE\d{9}$/.test(clean)) {
    return {
      scheme: 'VAT',
      value,
      valid: false,
      reason: 'DE VAT must be DE + 9 digits',
      checksumValidated: false,
    };
  }
  const digits = clean.slice(2);
  let p = 10;
  for (let i = 0; i < 8; i++) {
    let s = (parseInt(digits[i], 10) + p) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }
  const expected = 11 - p === 10 ? 0 : 11 - p;
  const valid = expected === parseInt(digits[8], 10);
  return {
    scheme: 'VAT',
    value,
    valid,
    reason: valid ? undefined : 'DE VAT ISO 7064 Mod 11,10 checksum failed',
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spanish VAT/NIF/NIE/CIF — ES + 9 chars
// ─────────────────────────────────────────────────────────────────────────────

const ES_NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';
const CIF_DIGIT_ONLY_ORG = new Set(['A', 'B', 'E', 'H']);
const CIF_LETTER_ONLY_ORG = new Set(['K', 'P', 'Q', 'S', 'W']);

function cifControlDigit(digits: string): number {
  let sumOdd = 0;
  for (const i of [0, 2, 4, 6]) sumOdd += parseInt(digits[i], 10);
  let sumEven = 0;
  for (const i of [1, 3, 5]) {
    const d = parseInt(digits[i], 10) * 2;
    sumEven += d > 9 ? d - 9 : d;
  }
  return (10 - ((sumOdd + sumEven) % 10)) % 10;
}

export function validateEsVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^ES[A-Z0-9]{9}$/.test(clean)) {
    return {
      scheme: 'VAT',
      value,
      valid: false,
      reason: 'ES VAT must be ES + 9 alphanumeric chars',
      checksumValidated: false,
    };
  }
  const body = clean.slice(2);
  if (/^\d{8}[A-Z]$/.test(body)) {
    const num = parseInt(body.slice(0, 8), 10);
    const expected = ES_NIF_LETTERS[num % 23];
    const valid = body[8] === expected;
    return {
      scheme: 'VAT',
      value,
      valid,
      reason: valid ? undefined : `ES NIF letter mismatch (expected ${expected})`,
      checksumValidated: true,
    };
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(body)) {
    const prefix = body[0] === 'X' ? '0' : body[0] === 'Y' ? '1' : '2';
    const num = parseInt(prefix + body.slice(1, 8), 10);
    const expected = ES_NIF_LETTERS[num % 23];
    const valid = body[8] === expected;
    return {
      scheme: 'VAT',
      value,
      valid,
      reason: valid ? undefined : `ES NIE letter mismatch (expected ${expected})`,
      checksumValidated: true,
    };
  }
  if (/^[A-Z]\d{7}[A-Z0-9]$/.test(body)) {
    const orgType = body[0];
    const digits = body.slice(1, 8);
    const ctrl = body[8];
    const ctrlDigit = cifControlDigit(digits);
    const ctrlLetter = CIF_CONTROL_LETTERS[ctrlDigit];

    let valid: boolean;
    let reason: string | undefined;
    if (CIF_DIGIT_ONLY_ORG.has(orgType)) {
      valid = ctrl === String(ctrlDigit);
      if (!valid)
        reason = `ES CIF control char mismatch for org type ${orgType} (expected digit '${ctrlDigit}', got '${ctrl}')`;
    } else if (CIF_LETTER_ONLY_ORG.has(orgType)) {
      valid = ctrl === ctrlLetter;
      if (!valid)
        reason = `ES CIF control char mismatch for org type ${orgType} (expected letter '${ctrlLetter}', got '${ctrl}')`;
    } else {
      valid = ctrl === String(ctrlDigit) || ctrl === ctrlLetter;
      if (!valid)
        reason = `ES CIF control char mismatch (expected '${ctrlDigit}' or '${ctrlLetter}', got '${ctrl}')`;
    }
    return { scheme: 'VAT', value, valid, reason, checksumValidated: true };
  }
  return {
    scheme: 'VAT',
    value,
    valid: true,
    reason: 'Structural check only (unrecognised ES pattern)',
    checksumValidated: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic VAT dispatcher (routes by country prefix in the VAT number)
// ─────────────────────────────────────────────────────────────────────────────

export function validateVat(value: string, countryHint?: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  const country = (countryHint?.toUpperCase() ?? clean.slice(0, 2)) as string;
  switch (country) {
    case 'FR':
      return validateFrVat(clean);
    case 'IT': {
      if (/^IT\d{11}$/.test(clean)) return validateItVat(clean.slice(2));
      if (/^\d{11}$/.test(clean)) return validateItVat(clean);
      return {
        scheme: 'VAT',
        value,
        valid: false,
        reason: 'IT VAT must be IT + 11 digits',
        checksumValidated: false,
      };
    }
    case 'DE':
      return validateDeVat(clean);
    case 'ES':
      return validateEsVat(clean);
    case 'PL': {
      if (/^PL\d{10}$/.test(clean)) {
        const r = validateNip(clean.slice(2));
        return { ...r, scheme: 'VAT', value };
      }
      return {
        scheme: 'VAT',
        value,
        valid: false,
        reason: 'PL VAT must be PL + 10 digits (NIP)',
        checksumValidated: false,
      };
    }
    default:
      return {
        scheme: 'VAT',
        value,
        valid: true,
        reason: `Structural only — country "${country}" not covered by offline checksum`,
        checksumValidated: false,
      };
  }
}

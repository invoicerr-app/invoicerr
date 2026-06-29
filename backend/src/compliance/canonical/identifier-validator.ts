/**
 * Pure offline identifier validators — checksum & structural.
 * No network I/O. Each algorithm cites its authoritative reference.
 *
 * References
 *  SIREN/SIRET : Luhn — https://www.insee.fr/fr/metadonnees/definition/c1824
 *               https://www.insee.fr/fr/metadonnees/definition/c1839
 *  NIP (PL)    : https://pl.wikipedia.org/wiki/Numer_identyfikacji_podatkowej
 *  FR VAT      : https://fr.wikipedia.org/wiki/Num%C3%A9ro_de_TVA_intracommunautaire#France
 *  IT P.IVA    : https://it.wikipedia.org/wiki/Partita_IVA_(Italia)
 *  Cod.Fisc.   : https://it.wikipedia.org/wiki/Codice_fiscale#Generazione_del_codice_fiscale
 *  DE VAT      : ISO 7064 Mod 11,10 — https://en.wikipedia.org/wiki/VAT_identification_number#Germany
 *  ES VAT/NIF  : https://en.wikipedia.org/wiki/VAT_identification_number#Spain
 *  RFC (MX)    : https://en.wikipedia.org/wiki/Tax_identification_number_(Mexico)
 */

import type { TransactionContext } from './canonical-document';
import type { PartyIdentifier } from './canonical-document';

// ─────────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentifierValidationResult {
  scheme: string;
  value: string;
  /** true  = checksum or authoritative structural rule says VALID   */
  /** false = checksum / structural rule says INVALID                 */
  valid: boolean;
  reason?: string;
  /** true = a real checksum algorithm ran; false = structural/pattern only */
  checksumValidated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Luhn algorithm
// Used by: SIREN (9 digits), SIRET (14 digits).
// Reference: https://en.wikipedia.org/wiki/Luhn_algorithm
// ─────────────────────────────────────────────────────────────────────────────

function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIREN (FR)
// ─────────────────────────────────────────────────────────────────────────────

export function validateSiren(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(clean)) {
    return { scheme: 'SIREN', value, valid: false, reason: 'Must be exactly 9 digits', checksumValidated: false };
  }
  const valid = luhn(clean);
  return { scheme: 'SIREN', value, valid, reason: valid ? undefined : 'Luhn checksum failed', checksumValidated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIRET (FR) — 14 digits = SIREN (9) + NIC (5)
// Both the SIRET itself AND the embedded SIREN must pass Luhn.
// ─────────────────────────────────────────────────────────────────────────────

export function validateSiret(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{14}$/.test(clean)) {
    return { scheme: 'SIRET', value, valid: false, reason: 'Must be exactly 14 digits', checksumValidated: false };
  }
  if (!luhn(clean.slice(0, 9))) {
    return { scheme: 'SIRET', value, valid: false, reason: 'Embedded SIREN Luhn checksum failed', checksumValidated: true };
  }
  const valid = luhn(clean);
  return { scheme: 'SIRET', value, valid, reason: valid ? undefined : 'SIRET Luhn checksum failed', checksumValidated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// NIP (PL) — 10 digits, weighted checksum mod 11
// Weights: [6, 5, 7, 2, 3, 4, 5, 6, 7]; check digit = weighted_sum % 11
// Check digit == 10 is reserved/invalid.
// ─────────────────────────────────────────────────────────────────────────────

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function validateNip(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) {
    return { scheme: 'NIP', value, valid: false, reason: 'Must be exactly 10 digits', checksumValidated: false };
  }
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * parseInt(clean[i], 10), 0);
  const check = sum % 11;
  if (check === 10) {
    return { scheme: 'NIP', value, valid: false, reason: 'Check digit 10 is reserved (invalid NIP)', checksumValidated: true };
  }
  const valid = check === parseInt(clean[9], 10);
  return { scheme: 'NIP', value, valid, reason: valid ? undefined : 'NIP weighted checksum failed', checksumValidated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// French VAT (TVA intracommunautaire) — FR + 2-char key + 9-digit SIREN
// Numeric key only: expected = (12 + 3 × (SIREN mod 97)) mod 97.
// Alpha/mixed key (historical): structural check only.
// ─────────────────────────────────────────────────────────────────────────────

export function validateFrVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  // Key chars may be digits or uppercase letters except I and O
  if (!/^FR[0-9A-HJ-NP-Z]{2}\d{9}$/.test(clean)) {
    return { scheme: 'VAT', value, valid: false, reason: 'FR VAT: expected FRxx + 9 digits (x = digit or uppercase letter ≠ I/O)', checksumValidated: false };
  }
  const key = clean.slice(2, 4);
  const siren = clean.slice(4);
  if (/^\d{2}$/.test(key)) {
    const expected = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
    const actual = parseInt(key, 10);
    const valid = actual === expected;
    return {
      scheme: 'VAT', value, valid,
      reason: valid ? undefined : `FR VAT key mismatch (expected ${String(expected).padStart(2, '0')}, got ${key})`,
      checksumValidated: true,
    };
  }
  // Alpha key: structural only (letter encoding is historical, not checksum-verified here)
  return { scheme: 'VAT', value, valid: true, reason: 'Alpha key: structural check only', checksumValidated: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Italian Partita IVA — 11 digits
// Algorithm (ISO-equivalent Luhn-like):
//   S1 = sum of digits at 0-indexed positions 0,2,4,6,8
//   S2 = for positions 1,3,5,7,9: double each; if doubled > 9 subtract 9; sum
//   check = (10 − (S1+S2) % 10) % 10 must equal digit[10]
// ─────────────────────────────────────────────────────────────────────────────

export function validateItVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(clean)) {
    return { scheme: 'VAT', value, valid: false, reason: 'IT Partita IVA must be exactly 11 digits', checksumValidated: false };
  }
  let s1 = 0, s2 = 0;
  for (let i = 0; i < 10; i++) {
    const d = parseInt(clean[i], 10);
    if (i % 2 === 0) {
      s1 += d;
    } else {
      const dbl = d * 2;
      s2 += dbl > 9 ? dbl - 9 : dbl;
    }
  }
  const expected = (10 - (s1 + s2) % 10) % 10;
  const valid = expected === parseInt(clean[10], 10);
  return { scheme: 'VAT', value, valid, reason: valid ? undefined : 'IT P.IVA checksum failed', checksumValidated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Italian Codice Fiscale (individual: 16 chars)
// Check character algorithm — Ministero delle Finanze, circ. n. 23/E 1991.
// Delegates to validateItVat for 11-digit corporate CF.
// ─────────────────────────────────────────────────────────────────────────────

// Values for characters at ODD positions (1,3,5,… in 1-indexed — i.e., 0,2,4,… in 0-indexed).
const CF_ODD: Record<string, number> = {
  '0':1,'1':0,'2':5,'3':7,'4':9,'5':13,'6':15,'7':17,'8':19,'9':21,
  A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,N:20,
  O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23,
};
// Values for characters at EVEN positions (2,4,6,… in 1-indexed — i.e., 1,3,5,… in 0-indexed).
const CF_EVEN: Record<string, number> = {
  '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
  A:0,B:1,C:2,D:3,E:4,F:5,G:6,H:7,I:8,J:9,K:10,L:11,M:12,N:13,
  O:14,P:15,Q:16,R:17,S:18,T:19,U:20,V:21,W:22,X:23,Y:24,Z:25,
};
const CF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function validateCodiceFiscale(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  // 11-digit form: corporate CF = P.IVA
  if (/^\d{11}$/.test(clean)) {
    const r = validateItVat(clean);
    return { ...r, scheme: 'CF' };
  }
  if (!/^[A-Z0-9]{16}$/.test(clean)) {
    return { scheme: 'CF', value, valid: false, reason: 'Codice Fiscale must be 16 alphanumeric chars (or 11-digit P.IVA)', checksumValidated: false };
  }
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = clean[i];
    // Positions 0,2,4,… in 0-indexed = "odd" positions in 1-indexed convention
    sum += i % 2 === 0 ? (CF_ODD[ch] ?? 0) : (CF_EVEN[ch] ?? 0);
  }
  const expected = CF_ALPHABET[sum % 26];
  const valid = clean[15] === expected;
  return {
    scheme: 'CF', value, valid,
    reason: valid ? undefined : `Codice Fiscale check char mismatch (expected ${expected}, got ${clean[15]})`,
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// German VAT (Umsatzsteuer-Identifikationsnummer) — DE + 9 digits
// Algorithm: ISO 7064 Mod 11,10
// Reference: https://en.wikipedia.org/wiki/VAT_identification_number#Germany
// ─────────────────────────────────────────────────────────────────────────────

export function validateDeVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^DE\d{9}$/.test(clean)) {
    return { scheme: 'VAT', value, valid: false, reason: 'DE VAT must be DE + 9 digits', checksumValidated: false };
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
    scheme: 'VAT', value, valid,
    reason: valid ? undefined : 'DE VAT ISO 7064 Mod 11,10 checksum failed',
    checksumValidated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spanish VAT/NIF/NIE — ES + 9 chars
// NIF (individuals): ES + 8 digits + check letter
//   check = "TRWAGMYFPDXBNJZSQVHLCKE"[number % 23]
// NIE (EU foreigners): ES + X/Y/Z + 7 digits + check letter
//   X→0, Y→1, Z→2, then same NIF formula
// CIF (companies) and other forms: structural only
// Reference: https://en.wikipedia.org/wiki/VAT_identification_number#Spain
// ─────────────────────────────────────────────────────────────────────────────

const ES_NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function validateEsVat(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^ES[A-Z0-9]{9}$/.test(clean)) {
    return { scheme: 'VAT', value, valid: false, reason: 'ES VAT must be ES + 9 alphanumeric chars', checksumValidated: false };
  }
  const body = clean.slice(2);
  // NIF: 8 digits + letter
  if (/^\d{8}[A-Z]$/.test(body)) {
    const num = parseInt(body.slice(0, 8), 10);
    const expected = ES_NIF_LETTERS[num % 23];
    const valid = body[8] === expected;
    return { scheme: 'VAT', value, valid, reason: valid ? undefined : `ES NIF letter mismatch (expected ${expected})`, checksumValidated: true };
  }
  // NIE: X/Y/Z + 7 digits + letter
  if (/^[XYZ]\d{7}[A-Z]$/.test(body)) {
    const prefix = body[0] === 'X' ? '0' : body[0] === 'Y' ? '1' : '2';
    const num = parseInt(prefix + body.slice(1, 8), 10);
    const expected = ES_NIF_LETTERS[num % 23];
    const valid = body[8] === expected;
    return { scheme: 'VAT', value, valid, reason: valid ? undefined : `ES NIE letter mismatch (expected ${expected})`, checksumValidated: true };
  }
  // CIF (letter + 7 digits + alphanumeric) and other patterns: structural only
  return { scheme: 'VAT', value, valid: true, reason: 'Structural check only (CIF or unrecognised ES pattern)', checksumValidated: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mexican RFC (Registro Federal de Contribuyentes)
// Person:  4 letters  + 6 digits (YYMMDD) + 3 homoclave = 13 chars
// Company: 3 letters  + 6 digits (YYMMDD) + 3 homoclave = 12 chars
// Special generic RFCs (XAXX010101000, XEXX010101000) are valid.
// No public check-digit algorithm is defined; structural only.
// Reference: https://en.wikipedia.org/wiki/Tax_identification_number_(Mexico)
// ─────────────────────────────────────────────────────────────────────────────

const RFC_PERSON_RE = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
const RFC_COMPANY_RE = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;

export function validateRfc(value: string): IdentifierValidationResult {
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  const valid = RFC_PERSON_RE.test(clean) || RFC_COMPANY_RE.test(clean);
  return {
    scheme: 'RFC', value, valid,
    reason: valid ? undefined : 'RFC must be 3–4 letters/& + 6 digits (YYMMDD) + 3 alphanumeric chars',
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
    case 'FR': return validateFrVat(clean);
    case 'IT': {
      // IT EU VAT: IT + 11 digits
      if (/^IT\d{11}$/.test(clean)) {
        return validateItVat(clean.slice(2));
      }
      // Bare 11 digits
      if (/^\d{11}$/.test(clean)) {
        return validateItVat(clean);
      }
      return { scheme: 'VAT', value, valid: false, reason: 'IT VAT must be IT + 11 digits', checksumValidated: false };
    }
    case 'DE': return validateDeVat(clean);
    case 'ES': return validateEsVat(clean);
    case 'PL': {
      // PL EU VAT = PL + 10-digit NIP
      if (/^PL\d{10}$/.test(clean)) {
        const r = validateNip(clean.slice(2));
        return { ...r, scheme: 'VAT', value };
      }
      return { scheme: 'VAT', value, valid: false, reason: 'PL VAT must be PL + 10 digits (NIP)', checksumValidated: false };
    }
    default:
      return {
        scheme: 'VAT', value, valid: true,
        reason: `Structural only — country "${country}" not covered by offline checksum`,
        checksumValidated: false,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dispatch entry-point
// ─────────────────────────────────────────────────────────────────────────────

export function validateIdentifier(
  scheme: string,
  value: string,
  countryCode?: string,
): IdentifierValidationResult {
  switch (scheme.toUpperCase()) {
    case 'SIREN':  return validateSiren(value);
    case 'SIRET':  return validateSiret(value);
    case 'NIP':    return validateNip(value);
    case 'CF':     return validateCodiceFiscale(value);
    case 'RFC':    return validateRfc(value);
    case 'VAT':    return validateVat(value, countryCode);
    default:
      return { scheme, value, valid: true, reason: `Scheme "${scheme}" not covered by offline validator`, checksumValidated: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TransactionContext helper — validates all identifiers in both parties,
// returns an updated ctx with the `validated` flag set based on checksum
// results, plus an array of warning strings for any failures.
// ─────────────────────────────────────────────────────────────────────────────

function flagIdentifiers(
  identifiers: PartyIdentifier[],
  countryCode: string,
  partyLabel: string,
): { identifiers: PartyIdentifier[]; warnings: string[]; changed: boolean } {
  const warnings: string[] = [];
  let changed = false;
  const updated = identifiers.map((id): PartyIdentifier => {
    const result = validateIdentifier(id.scheme, id.value, countryCode);
    if (!result.checksumValidated) {
      // No checksum available — preserve existing validated flag, no warning
      return id;
    }
    if (!result.valid) {
      warnings.push(
        `[identifier-validator] ${partyLabel} ${id.scheme} "${id.value}": ${result.reason ?? 'invalid'}`,
      );
    }
    if (id.validated !== result.valid) changed = true;
    return { ...id, validated: result.valid };
  });
  return { identifiers: updated, warnings, changed };
}

export interface ValidatedContextResult {
  ctx: TransactionContext;
  warnings: string[];
}

/**
 * Runs offline checksum validation on supplier + buyer identifiers.
 * Returns an updated TransactionContext with `validated` flags set and a
 * list of human-readable warnings for any checksum failures.
 *
 * Does NOT make network calls — always safe to call in hot paths.
 */
export function validateContextIdentifiers(ctx: TransactionContext): ValidatedContextResult {
  const allWarnings: string[] = [];

  const supplier = flagIdentifiers(ctx.supplier.identifiers, ctx.supplier.countryCode, 'supplier');
  allWarnings.push(...supplier.warnings);

  const buyer = flagIdentifiers(ctx.buyer.identifiers, ctx.buyer.countryCode, 'buyer');
  allWarnings.push(...buyer.warnings);

  if (!supplier.changed && !buyer.changed) {
    // Neither party's identifiers changed — return the original object to avoid allocation
    return { ctx, warnings: allWarnings };
  }

  return {
    ctx: {
      ...ctx,
      supplier: { ...ctx.supplier, identifiers: supplier.identifiers },
      buyer:    { ...ctx.buyer,    identifiers: buyer.identifiers },
    },
    warnings: allWarnings,
  };
}

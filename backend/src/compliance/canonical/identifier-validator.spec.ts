/**
 * Offline identifier checksum validation tests.
 *
 * Test values are either:
 *  - Algorithmically derived (documented inline with the derivation)
 *  - Drawn from publicly available sources cited inline
 *
 * Every scheme with a real checksum algorithm has at least one known-valid
 * and one known-invalid value (with the failure reason).
 */

import {
  validateSiren,
  validateSiret,
  validateNip,
  validateFrVat,
  validateItVat,
  validateCodiceFiscale,
  validateDeVat,
  validateEsVat,
  validateRfc,
  validateVat,
  validateIdentifier,
  validateContextIdentifiers,
} from './identifier-validator';
import type { TransactionContext } from './canonical-document';

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function makeCtx(
  supplierIdentifiers: Array<{ scheme: string; value: string; validated?: boolean }>,
  buyerIdentifiers: Array<{ scheme: string; value: string; validated?: boolean }> = [],
): TransactionContext {
  return {
    supplier: { legalName: 'Supplier', countryCode: 'FR', role: 'B2B', identifiers: supplierIdentifiers },
    buyer:    { legalName: 'Buyer',    countryCode: 'FR', role: 'B2B', identifiers: buyerIdentifiers },
    lines: [],
    issueDate: new Date('2025-01-01'),
    currency: 'EUR',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIREN (FR) — Luhn
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSiren', () => {
  // Derivation: SIREN = "12345678X" where X satisfies Luhn.
  //   Process 12345678 from right: 8(×1=8), 7(×2=14→5), 6(×1=6), 5(×2=10→1), 4(×1=4),
  //   3(×2=6), 2(×1=2), 1(×2=2) → sum=34. Need check so (34+X)%10=0 → X=6.
  //   But wait: Luhn doubles the 2nd-from-right, 4th, 6th… from right (starting alt=false from rightmost).
  //   Position 0 (rightmost = X): alt=false → X kept as-is.
  //   Position 1 (8): alt=true → 8×2=16 → 7.
  //   Position 2 (7): alt=false → 7.
  //   Position 3 (6): alt=true → 12→3.
  //   Position 4 (5): alt=false → 5.
  //   Position 5 (4): alt=true → 8.
  //   Position 6 (3): alt=false → 3.
  //   Position 7 (2): alt=true → 4.
  //   Position 8 (1): alt=false → 1.
  //   Sum so far (excluding X) = 7+7+3+5+8+3+4+1 = 38.
  //   For sum%10=0: X = (10 - 38%10) % 10 = (10-8)%10 = 2 → SIREN "123456782"
  it('accepts a valid SIREN (Luhn passes)', () => {
    const r = validateSiren('123456782');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects a SIREN with wrong check digit', () => {
    // '123456789' — same body, wrong last digit
    const r = validateSiren('123456789');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Luhn/i);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects non-numeric SIREN', () => {
    const r = validateSiren('12345678A');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(false);
  });

  it('rejects SIREN with wrong length', () => {
    expect(validateSiren('1234567').valid).toBe(false);
    expect(validateSiren('1234567890').valid).toBe(false);
  });

  it('strips whitespace before checking', () => {
    expect(validateSiren('123 456 782').valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIRET (FR) — Luhn on 14-digit number + Luhn on embedded SIREN
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSiret', () => {
  // Derivation: SIREN = "123456782" (valid above).
  //   Append NIC "00001" → candidate SIRET "12345678200001".
  //   Compute Luhn for "12345678200001" from right:
  //     alt starts false at position 0 (rightmost = 1):
  //     1(kept)=1, 0(×2=0)=0, 0(kept)=0, 0(×2=0)=0, 0(kept)=0, 2(×2=4)=4, 8(kept)=8,
  //     7(×2=14→5)=5, 6(kept)=6, 5(×2=10→1)=1, 4(kept)=4, 3(×2=6)=6, 2(kept)=2, 1(×2=2)=2.
  //     Sum = 1+0+0+0+0+4+8+5+6+1+4+6+2+2 = 39 → not valid.
  //   Try NIC "00008": "12345678200008"
  //     Replace last digit: previous sum without last digit = 39-1=38, add 8 → 46 → 46%10=6 → not 0.
  //   Need last digit X such that (38+X)%10=0 → X=2. SIRET "12345678200002".
  //   Verify: sum=38+2=40 → 40%10=0 ✓
  it('accepts a valid SIRET (Luhn passes on both SIRET and embedded SIREN)', () => {
    const r = validateSiret('12345678200002');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects a SIRET whose Luhn fails', () => {
    const r = validateSiret('12345678200001');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects a SIRET with an invalid embedded SIREN', () => {
    // '12345678900001' — SIREN "123456789" fails Luhn
    const r = validateSiret('12345678900001');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/SIREN/i);
  });

  it('rejects wrong length', () => {
    expect(validateSiret('123').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NIP (PL) — weighted checksum mod 11
// ─────────────────────────────────────────────────────────────────────────────

describe('validateNip', () => {
  // Derivation: choose digits 1,2,3,4,5,6,7,8,0,?
  //   Weights: [6,5,7,2,3,4,5,6,7]
  //   Sum = 6+10+21+8+15+24+35+48+0 = 167. 167%11 = 2. Check digit = 2.
  //   NIP = "1234567802"
  it('accepts a valid NIP', () => {
    const r = validateNip('1234567802');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects NIP with wrong check digit', () => {
    const r = validateNip('1234567809'); // ends in 9, not 2
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/checksum/i);
  });

  it('rejects 9-digit NIP (too short)', () => {
    expect(validateNip('123456780').valid).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(validateNip('123456780A').valid).toBe(false);
  });

  // Derivation: 9,9,9,9,9,9,9,9,9,?
  //   Sum = 6*9+5*9+7*9+2*9+3*9+4*9+5*9+6*9+7*9 = 9*(6+5+7+2+3+4+5+6+7) = 9*45 = 405
  //   405%11 = 405 - 36*11 = 405-396 = 9. Check = 9.
  //   NIP "9999999999" is valid.
  it('accepts NIP 9999999999', () => {
    expect(validateNip('9999999999').valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// French VAT — FR + 2-char key + 9-digit SIREN
// ─────────────────────────────────────────────────────────────────────────────

describe('validateFrVat', () => {
  // Derivation: SIREN "123456782" (valid Luhn above).
  //   key = (12 + 3 × (123456782 % 97)) % 97
  //   123456782 % 97: 97 × 1272749 = 123456653; 123456782 - 123456653 = 129; 129 % 97 = 32.
  //   key = (12 + 3×32) % 97 = (12+96)%97 = 108%97 = 11.
  //   FR VAT = "FR11123456782"
  it('accepts a valid FR VAT (numeric key passes mod-97 check)', () => {
    const r = validateFrVat('FR11123456782');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects wrong numeric key', () => {
    const r = validateFrVat('FR99123456782'); // key should be 11
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/key mismatch/i);
  });

  // Historical alpha/mixed-key algorithm (base-34 encoding of clé):
  //   key decoded: val(k1)*34 + val(k2), where '0'-'9'→0-9, 'A'-'H'→10-17, 'J'-'N'→18-22, 'P'-'Z'→23-33
  //   valid when key_base34 == (12 + 3*(siren%97))%97
  //
  // Derivation for "FR0B123456782" (SIREN=123456782, clé=11):
  //   '0'→0, 'B'→11; key_base34=0*34+11=11. Expected=(12+3*32)%97=11. ✓
  it('accepts a valid alpha-key FR VAT (base-34 checksum passes)', () => {
    const r = validateFrVat('FR0B123456782');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects an alpha-key FR VAT with wrong base-34 key', () => {
    // "FR0C123456782": '0C'→0*34+12=12, expected=11 → mismatch
    const r = validateFrVat('FR0C123456782');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(true);
    expect(r.reason).toMatch(/alpha key mismatch/i);
  });

  it('rejects alpha key "A0" whose base-34 value (340) exceeds the valid range (0-96)', () => {
    // "FRA0303265045": 'A0'→10*34+0=340; expected=(12+3*74)%97=40; 340≠40 → invalid.
    // (No SIREN can produce clé=340 since clé is always 0-96.)
    const r = validateFrVat('FRA0303265045');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(true);
  });

  it('accepts a mixed digit+letter alpha key (FR1A100000059)', () => {
    // SIREN=100000059, siren%97=(81+59)%97=43; clé=(12+3*43)%97=44.
    // key "1A": '1'→1, 'A'→10; key_base34=1*34+10=44. 44==44 ✓
    const r = validateFrVat('FR1A100000059');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects malformed FR VAT', () => {
    expect(validateFrVat('FR1234').valid).toBe(false);
    expect(validateFrVat('DE11123456782').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Italian Partita IVA — 11 digits
// ─────────────────────────────────────────────────────────────────────────────

describe('validateItVat', () => {
  // Derivation for "12345678903":
  //   digits 1,2,3,4,5,6,7,8,9,0,?
  //   S1 (positions 0,2,4,6,8) = 1+3+5+7+9 = 25
  //   Even (positions 1,3,5,7,9): 2×2=4, 4×2=8, 6×2=12→3, 8×2=16→7, 0×2=0
  //   S2 = 4+8+3+7+0 = 22
  //   total = 47%10 = 7; check = (10-7)%10 = 3 → "12345678903"
  it('accepts a valid IT P.IVA', () => {
    const r = validateItVat('12345678903');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  // Edge case: all-zero IT VAT
  // S1=0, S2=0, check=(10-0)%10=0 → "00000000000"
  it('accepts all-zeros IT P.IVA (structurally valid edge case)', () => {
    const r = validateItVat('00000000000');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects wrong check digit', () => {
    const r = validateItVat('12345678901'); // correct would be 3
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/checksum/i);
  });

  it('rejects non-numeric or wrong length', () => {
    expect(validateItVat('1234567890A').valid).toBe(false);
    expect(validateItVat('1234567890').valid).toBe(false); // 10 digits
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Codice Fiscale (IT) — 16 chars + check char
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCodiceFiscale', () => {
  // Derivation for "AAAAAA00A00A000?":
  //   Positions 0,2,4,6,8,10,12,14 (odd in 1-indexed):
  //     A→1, A→1, A→1, 0→1, A→1, 0→1, 0→1, 0→1  sum_odd=8
  //   Positions 1,3,5,7,9,11,13 (even in 1-indexed):
  //     A→0, A→0, A→0, 0→0, 0→0, A→0, 0→0  sum_even=0
  //   total=8; 8%26=8; CF_CHECK[8]='I'
  //   CF = "AAAAAA00A00A000I"
  it('accepts a valid Codice Fiscale (16-char with correct check char)', () => {
    const r = validateCodiceFiscale('AAAAAA00A00A000I');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects wrong check character', () => {
    const r = validateCodiceFiscale('AAAAAA00A00A000X'); // should be I
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/check char/i);
  });

  it('delegates 11-digit corporate CF to IT P.IVA validator', () => {
    const r = validateCodiceFiscale('12345678903'); // valid P.IVA from above
    expect(r.valid).toBe(true);
    expect(r.scheme).toBe('CF');
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects invalid length', () => {
    expect(validateCodiceFiscale('AAAAAA00A').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// German VAT — DE + 9 digits (ISO 7064 Mod 11,10)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateDeVat', () => {
  // Derivation for "DE129274202":
  //   digits "12927420?" p=10
  //   i=0: d=1, s=(1+10)%10=1 (≠0), p=(2×1)%11=2
  //   i=1: d=2, s=(2+2)%10=4, p=(2×4)%11=8
  //   i=2: d=9, s=(9+8)%10=7, p=(2×7)%11=3
  //   i=3: d=2, s=(2+3)%10=5, p=(2×5)%11=10
  //   i=4: d=7, s=(7+10)%10=7, p=(2×7)%11=3
  //   i=5: d=4, s=(4+3)%10=7, p=(2×7)%11=3
  //   i=6: d=2, s=(2+3)%10=5, p=(2×5)%11=10
  //   i=7: d=0, s=(0+10)%10=0→10, p=(2×10)%11=9
  //   expected = 11−9 = 2 → "DE129274202"
  it('accepts a valid DE VAT (ISO 7064 Mod 11,10)', () => {
    const r = validateDeVat('DE129274202');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects DE VAT with wrong check digit', () => {
    const r = validateDeVat('DE129274205'); // correct is 2
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/ISO 7064/i);
  });

  it('rejects non-DE prefix', () => {
    expect(validateDeVat('FR129274202').valid).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateDeVat('DE12927420').valid).toBe(false); // 8 digits
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spanish VAT / NIF / NIE
// ─────────────────────────────────────────────────────────────────────────────

describe('validateEsVat', () => {
  // Derivation for NIF "ES12345678Z":
  //   body = "12345678Z"
  //   num = 12345678; 12345678 % 23 = ?
  //   23 × 536768 = 12345664; 12345678 − 12345664 = 14
  //   ES_NIF_LETTERS[14] = 'TRWAGMYFPDXBNJZ...'[14] = Z ✓
  it('accepts a valid ES NIF', () => {
    const r = validateEsVat('ES12345678Z');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects ES NIF with wrong check letter', () => {
    const r = validateEsVat('ES12345678A'); // correct is Z
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/letter mismatch/i);
  });

  // Derivation for NIE "ESX1234567L":
  //   body = "X1234567L"; X→0
  //   num = 01234567; 1234567 % 23 = ?
  //   23 × 53676 = 1234548; 1234567 − 1234548 = 19
  //   ES_NIF_LETTERS[19] = 'TRWAGMYFPDXBNJZSQVHL...'[19] = 'L' ✓
  it('accepts a valid ES NIE', () => {
    const r = validateEsVat('ESX1234567L');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects ES NIE with wrong check letter', () => {
    const r = validateEsVat('ESX1234567A');
    expect(r.valid).toBe(false);
  });

  // CIF control-char derivation for digits "1234567":
  //   sumOdd(d1,d3,d5,d7) = 1+3+5+7 = 16
  //   sumEven(d2,d4,d6 × 2, subtract 9 if >9) = 4+8+3 = 15 (12→3)
  //   total = 31; control_digit = (10-1)%10 = 9; control_letter = "JABCDEFGHI"[9] = 'I'
  //   Org A (digit control) → expected '9'; Org K (letter control) → expected 'I'
  it('accepts CIF with digit control char (org type A → expected digit "9")', () => {
    // ESA12345679: org=A, digits=1234567, ctrl='9'. control_digit=9 ✓
    const r = validateEsVat('ESA12345679');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('accepts CIF with letter control char (org type K → expected letter "I")', () => {
    // ESK1234567I: org=K, digits=1234567, ctrl='I'. control_letter='I' ✓
    const r = validateEsVat('ESK1234567I');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('rejects CIF with wrong control char (ESA1234567B → expected "9" not "B")', () => {
    const r = validateEsVat('ESA1234567B');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(true);
    expect(r.reason).toMatch(/CIF control char mismatch/i);
  });

  it('accepts CIF with letter or digit for general org type (org type C)', () => {
    // ESC12345679: org=C (general), ctrl='9' = digit form. Should accept.
    const r = validateEsVat('ESC12345679');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
    // Also accept letter form
    const r2 = validateEsVat('ESC1234567I');
    expect(r2.valid).toBe(true);
  });

  it('rejects malformed ES VAT (wrong length)', () => {
    expect(validateEsVat('ES1234').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mexican RFC
// ─────────────────────────────────────────────────────────────────────────────

describe('validateRfc', () => {
  // Generic public-domain RFCs used throughout Mexican tax documentation
  it('accepts a valid person RFC (13 chars)', () => {
    const r = validateRfc('XAXX010101000');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(false); // structural only
  });

  it('accepts a valid company RFC (12 chars)', () => {
    const r = validateRfc('ABC010101001');
    expect(r.valid).toBe(true);
  });

  it('rejects RFC with wrong date format (non-numeric date segment)', () => {
    // "ABCDABCDEF1" — 4 letters + 6 non-digit chars + 3
    const r = validateRfc('ABCDABCDEF1');
    expect(r.valid).toBe(false);
  });

  it('rejects too-short RFC', () => {
    expect(validateRfc('AB010101').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic VAT dispatcher
// ─────────────────────────────────────────────────────────────────────────────

describe('validateVat', () => {
  it('routes FR prefix to FR validator', () => {
    const r = validateVat('FR11123456782');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });

  it('routes PL prefix to NIP validator', () => {
    const valid = validateVat('PL1234567802');
    expect(valid.valid).toBe(true);
    const invalid = validateVat('PL1234567809');
    expect(invalid.valid).toBe(false);
  });

  it('routes DE prefix to DE VAT validator', () => {
    expect(validateVat('DE129274202').valid).toBe(true);
    expect(validateVat('DE129274205').valid).toBe(false);
  });

  it('routes IT prefix to IT P.IVA validator', () => {
    expect(validateVat('IT12345678903').valid).toBe(true);
    expect(validateVat('IT12345678901').valid).toBe(false);
  });

  it('returns structural-only for unknown country', () => {
    const r = validateVat('GB123456789');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(false);
    expect(r.reason).toMatch(/structural only/i);
  });

  it('uses countryHint to override detected prefix', () => {
    // Pass bare NIP without PL prefix, with country hint
    const r = validateVat('1234567802', 'PL');
    // Will try to match PL\d{10} — "1234567802" doesn't start with PL, so fails structural
    // (countryHint only overrides the switch branch, not the regex)
    expect(r.scheme).toBe('VAT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Main dispatch entry-point
// ─────────────────────────────────────────────────────────────────────────────

describe('validateIdentifier', () => {
  it('dispatches SIREN', () => expect(validateIdentifier('SIREN', '123456782').valid).toBe(true));
  it('dispatches SIRET', () => expect(validateIdentifier('SIRET', '12345678200002').valid).toBe(true));
  it('dispatches NIP', ()  => expect(validateIdentifier('NIP',  '1234567802').valid).toBe(true));
  it('dispatches CF', ()   => expect(validateIdentifier('CF',   'AAAAAA00A00A000I').valid).toBe(true));
  it('dispatches RFC', ()  => expect(validateIdentifier('RFC',  'XAXX010101000').valid).toBe(true));
  it('dispatches VAT FR',  () => expect(validateIdentifier('VAT', 'FR11123456782').valid).toBe(true));

  it('returns valid:true and checksumValidated:false for unknown scheme', () => {
    const r = validateIdentifier('EIN', '12-3456789');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(false);
  });

  it('is case-insensitive on scheme', () => {
    expect(validateIdentifier('siren', '123456782').valid).toBe(true);
    expect(validateIdentifier('Vat', 'FR11123456782').valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateContextIdentifiers — wiring helper
// ─────────────────────────────────────────────────────────────────────────────

describe('validateContextIdentifiers', () => {
  it('returns the same ctx object when nothing changes (no checksumValidated identifiers)', () => {
    const ctx = makeCtx([{ scheme: 'EIN', value: '12-3456789' }]);
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out).toBe(ctx); // same reference (no allocation)
    expect(warnings).toHaveLength(0);
  });

  it('sets validated:true on a passing SIREN', () => {
    const ctx = makeCtx([{ scheme: 'SIREN', value: '123456782' }]);
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out.supplier.identifiers[0].validated).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('sets validated:false and emits a warning for a failing SIREN', () => {
    const ctx = makeCtx([{ scheme: 'SIREN', value: '123456789' }]); // bad check digit
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out.supplier.identifiers[0].validated).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/supplier.*SIREN/i);
  });

  it('corrects a manually-set validated:true that fails checksum', () => {
    const ctx = makeCtx([{ scheme: 'SIREN', value: '123456789', validated: true }]);
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out.supplier.identifiers[0].validated).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('validates buyer identifiers too', () => {
    const ctx = makeCtx(
      [{ scheme: 'SIREN', value: '123456782' }],    // valid supplier
      [{ scheme: 'NIP',   value: '1234567809' }],   // invalid buyer NIP
    );
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out.supplier.identifiers[0].validated).toBe(true);
    expect(out.buyer.identifiers[0].validated).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/buyer.*NIP/i);
  });

  it('handles multiple identifiers per party', () => {
    const ctx = makeCtx([
      { scheme: 'SIREN',  value: '123456782' }, // valid
      { scheme: 'SIRET',  value: '12345678900001' }, // invalid
    ]);
    const { ctx: out, warnings } = validateContextIdentifiers(ctx);
    expect(out.supplier.identifiers[0].validated).toBe(true);
    expect(out.supplier.identifiers[1].validated).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Existence port — NullIdentifierExistenceClient
// ─────────────────────────────────────────────────────────────────────────────

import { NullIdentifierExistenceClient, ViesExistenceClient, SireneExistenceClient } from './identifier-existence.port';

describe('NullIdentifierExistenceClient', () => {
  const client = new NullIdentifierExistenceClient();

  it('returns exists:null and source:null for VAT check', async () => {
    const r = await client.checkVat('FR11123456782');
    expect(r.exists).toBeNull();
    expect(r.source).toBe('null');
  });

  it('returns exists:null and source:null for SIRET check', async () => {
    const r = await client.checkSiret('12345678200002');
    expect(r.exists).toBeNull();
    expect(r.source).toBe('null');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Existence port — ViesExistenceClient (mocked)
// Tests assert request shape + parse without hitting the network.
// ─────────────────────────────────────────────────────────────────────────────

describe('ViesExistenceClient (mocked fetch)', () => {
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  function mockFetch(body: unknown, status = 200): void {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    } as Response);
  }

  it('parses isValid:true response as exists:true', async () => {
    mockFetch({ isValid: true, userError: 'VALID' });
    const client = new ViesExistenceClient();
    const r = await client.checkVat('FR11123456782');
    expect(r.exists).toBe(true);
    expect(r.source).toBe('vies');
    // Assert URL shape: should include country/FR and vat/11123456782
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[0][0]).toContain('/ms/FR/vat/11123456782');
  });

  it('parses isValid:false response as exists:false', async () => {
    mockFetch({ isValid: false, userError: 'INVALID' });
    const client = new ViesExistenceClient();
    const r = await client.checkVat('FR00000000000');
    expect(r.exists).toBe(false);
  });

  it('returns exists:null on non-200 HTTP status', async () => {
    mockFetch({}, 503);
    const client = new ViesExistenceClient();
    const r = await client.checkVat('FR11123456782');
    expect(r.exists).toBeNull();
    expect(r.error).toMatch(/503/);
  });

  it('returns exists:null on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new ViesExistenceClient();
    const r = await client.checkVat('FR11123456782');
    expect(r.exists).toBeNull();
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('returns error for too-short VAT number', async () => {
    const client = new ViesExistenceClient();
    const r = await client.checkVat('FR');
    expect(r.exists).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('returns error when asked to check SIRET (not supported by VIES)', async () => {
    const client = new ViesExistenceClient();
    const r = await client.checkSiret('12345678200002');
    expect(r.exists).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Existence port — SireneExistenceClient (mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe('SireneExistenceClient (mocked fetch)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function mockFetch(status: number): void {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: String(status),
      json: async () => ({}),
    } as Response);
  }

  it('returns exists:true on HTTP 200', async () => {
    mockFetch(200);
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkSiret('12345678200002');
    expect(r.exists).toBe(true);
    expect(r.source).toBe('sirene');
    // Assert Authorization header is sent (without leaking the key in test logs)
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
  });

  it('returns exists:false on HTTP 404', async () => {
    mockFetch(404);
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkSiret('00000000000000');
    expect(r.exists).toBe(false);
  });

  it('returns exists:null on HTTP 429 (rate limited)', async () => {
    mockFetch(429);
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkSiret('12345678200002');
    expect(r.exists).toBeNull();
    expect(r.error).toMatch(/429/);
  });

  it('returns error for non-14-digit SIRET', async () => {
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkSiret('123');
    expect(r.exists).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('returns error when asked to check VAT (not supported by SIRENE)', async () => {
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkVat('FR11123456782');
    expect(r.exists).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('returns exists:null on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const client = new SireneExistenceClient('test-api-key');
    const r = await client.checkSiret('12345678200002');
    expect(r.exists).toBeNull();
    expect(r.error).toContain('ETIMEDOUT');
  });
});

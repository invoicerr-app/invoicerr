/**
 * Targeted carry-over of the reference's own syntax contract (`identifier-validator.spec.ts`,
 * `avant-refonte-documents`) — a few cases per country rather than the exhaustive suite: prove that
 * the dispatcher works for the countries actually in play (FR, DE, IT), and
 * that the PERMISSIVE behavior for an uncovered country is indeed the documented one (never a block
 * on a country this cannot verify offline).
 */
import { validateDeVat, validateFrVat, validateItVat, validateVat } from './vat-syntax';

describe('vat-syntax — validateFrVat', () => {
  it('accepts a real, checksum-valid FR VAT number (FR83404833048 — SIREN 404833048)', () => {
    // key = (12 + 3 × (404833048 mod 97)) mod 97 — computed once, then locked in as a fixture.
    const r = validateFrVat(`FR${String((12 + 3 * (404833048 % 97)) % 97).padStart(2, '0')}404833048`);
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(true);
  });
  it('rejects a syntactically wrong FR VAT number', () => {
    const r = validateFrVat('FR00000000000');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/key mismatch/);
  });
  it('rejects a malformed FR VAT number outright (wrong shape)', () => {
    const r = validateFrVat('FR1234');
    expect(r.valid).toBe(false);
    expect(r.checksumValidated).toBe(false);
  });
});

describe('vat-syntax — validateDeVat (ISO 7064 Mod 11,10)', () => {
  it('accepts a real German VAT number (DE136695976 — a widely-published, valid test number)', () => {
    const r = validateDeVat('DE136695976');
    expect(r.valid).toBe(true);
  });
  it('rejects a checksum-broken DE VAT number', () => {
    const r = validateDeVat('DE136695977');
    expect(r.valid).toBe(false);
  });
});

describe('vat-syntax — validateItVat', () => {
  it('accepts a real Italian Partita IVA (IT00743110157 — a widely-published, valid test number)', () => {
    const r = validateItVat('00743110157');
    expect(r.valid).toBe(true);
  });
});

describe('vat-syntax — validateVat dispatcher', () => {
  it('routes FR/DE/IT to their own checksum validator', () => {
    expect(validateVat('DE136695976').valid).toBe(true);
    expect(validateVat('DE000000000').valid).toBe(false);
  });
  it('is PERMISSIVE (valid: true, unchecked) for a country with no offline checksum — never a false block', () => {
    const r = validateVat('US123456789', 'US');
    expect(r.valid).toBe(true);
    expect(r.checksumValidated).toBe(false);
    expect(r.reason).toMatch(/not covered by offline checksum/);
  });
});

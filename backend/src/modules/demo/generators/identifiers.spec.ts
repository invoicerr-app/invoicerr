import { describe, expect, it } from 'vitest';

import {
  assertValidDeVat,
  assertValidFrIdentifiers,
  assertValidItPartitaIva,
  assertValidPlNip,
  assertValidPtNif,
  generateDeVat,
  generateFrIdentifiers,
  generateItPartitaIva,
  generatePlNip,
  generatePtNif,
  validatePtNif,
} from './identifiers';
import { createRng } from './rng';

// Several distinct seeds, deterministic — issue #533's own requirement: "add a test that runs the
// seed with several seeds and checks every country's documents validate".
const SEEDS = ['demo-seed-1', 'demo-seed-2', 42, 'a-very-different-seed', 2026_09_29];

describe('demo seed identifier generators — checksum round-trip against the real validators', () => {
  it.each(SEEDS)('FR SIRET + VAT are checksum-valid for seed %s', (seed) => {
    const rng = createRng(seed);
    for (let i = 0; i < 20; i++) {
      const ids = generateFrIdentifiers(rng);
      expect(() => assertValidFrIdentifiers(ids)).not.toThrow();
      expect(ids.siret).toMatch(/^\d{14}$/);
      expect(ids.vat).toMatch(/^FR[0-9A-Z]{2}\d{9}$/);
    }
  });

  it.each(SEEDS)('DE VAT is checksum-valid for seed %s', (seed) => {
    const rng = createRng(seed);
    for (let i = 0; i < 20; i++) {
      const vat = generateDeVat(rng);
      expect(() => assertValidDeVat(vat)).not.toThrow();
      expect(vat).toMatch(/^DE\d{9}$/);
    }
  });

  it.each(SEEDS)('IT Partita IVA is checksum-valid for seed %s', (seed) => {
    const rng = createRng(seed);
    for (let i = 0; i < 20; i++) {
      const piva = generateItPartitaIva(rng);
      expect(() => assertValidItPartitaIva(piva)).not.toThrow();
      expect(piva).toMatch(/^\d{11}$/);
    }
  });

  it.each(SEEDS)('PL NIP is checksum-valid for seed %s', (seed) => {
    const rng = createRng(seed);
    for (let i = 0; i < 20; i++) {
      const nip = generatePlNip(rng);
      expect(() => assertValidPlNip(nip)).not.toThrow();
      expect(nip).toMatch(/^\d{10}$/);
    }
  });

  it.each(SEEDS)('PT NIF is checksum-valid (own Módulo 11 validator) for seed %s', (seed) => {
    const rng = createRng(seed);
    for (let i = 0; i < 20; i++) {
      const nif = generatePtNif(rng);
      expect(() => assertValidPtNif(nif)).not.toThrow();
      expect(nif).toMatch(/^5\d{8}$/);
    }
  });

  it('validatePtNif rejects a mutated NIF (the check digit actually matters)', () => {
    const rng = createRng('mutation-check');
    const nif = generatePtNif(rng);
    const mutatedLastDigit = nif.slice(0, 8) + String((Number(nif[8]) + 1) % 10);
    expect(validatePtNif(nif).valid).toBe(true);
    expect(validatePtNif(mutatedLastDigit).valid).toBe(false);
  });

  it('is deterministic: the same seed produces the same identifiers every time', () => {
    const a = generateFrIdentifiers(createRng('reproducible'));
    const b = generateFrIdentifiers(createRng('reproducible'));
    expect(a).toEqual(b);
  });

  it('a fresh seed produces different identifiers (real randomness between resets)', () => {
    const a = generateFrIdentifiers(createRng('reset-run-1'));
    const b = generateFrIdentifiers(createRng('reset-run-2'));
    expect(a).not.toEqual(b);
  });
});

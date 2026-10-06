/**
 * Forward generators for the national identifiers the demo seed fills in. Each checksummed one mirrors
 * this codebase's own offline validator (`sirene.utils.ts`, `tax/vat-syntax.ts`) so a generated value
 * always passes it; the PT NIF has no validator elsewhere, so `validatePtNif` below implements the
 * published Modulo 11 algorithm. `DEMO_IDENTIFIER_GENERATORS` exposes them by algorithm id, the id a
 * country file's identifier scheme names in its `demoGenerator`.
 */
import { calculateFrenchVAT, isValidSiret } from '@/modules/sirene/sirene.utils';
import { validateDeVat, validateFrVat, validateItVat, validateNip } from '@/modules/documents/tax/vat-syntax';

import { DemoIdentifierGeneratorSpec } from '@/modules/documents/country-identifiers/schema';

import { Rng, intBetween } from './rng';

function randomDigits(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => intBetween(rng, 0, 9));
}

function digitsToString(digits: number[]): string {
  return digits.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// France: SIRET (14 digits, Luhn on even 0-based positions) + intra-EU VAT (derived from the SIREN)
// ─────────────────────────────────────────────────────────────────────────────

export interface FrIdentifiers {
  siret: string;
  siren: string;
  vat: string;
}

export function generateFrIdentifiers(rng: Rng): FrIdentifiers {
  const siret = generateSiret(rng);
  const siren = siret.slice(0, 9);
  const vat = calculateFrenchVAT(siren);
  return { siret, siren, vat };
}

export function generateSiret(rng: Rng): string {
  // Build the first 13 digits at random, then solve the 14th (an odd 0-based position, never
  // doubled, see `isValidSiret`'s own loop) so the FULL 14-digit Luhn sum is a multiple of 10.
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
  return digitsToString([...first13, checkDigit]);
}

export function assertValidFrIdentifiers({ siret, vat }: FrIdentifiers): void {
  if (!isValidSiret(siret)) throw new Error(`Generated an invalid FR SIRET: ${siret}`);
  const result = validateFrVat(vat);
  if (!result.valid) throw new Error(`Generated an invalid FR VAT number: ${vat} (${result.reason})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Germany: USt-IdNr, DE + 9 digits, ISO 7064 Mod 11,10 (mirrors `validateDeVat`'s own loop)
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
// Italy: Partita IVA, 11 digits, Luhn-like (mirrors `validateItVat`'s own loop)
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
// Poland: NIP, 10 digits, weighted mod 11 (mirrors `validateNip`'s own weights)
// ─────────────────────────────────────────────────────────────────────────────

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function generatePlNip(rng: Rng): string {
  for (;;) {
    const digits = randomDigits(rng, 9);
    const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
    const check = sum % 11;
    // check === 10 is a reserved, never-valid NIP (`validateNip`'s own refusal): redraw rather than
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
// Portugal: NIF/NIPC, 9 digits, standard Módulo 11. First digit fixed to '5' (sociedade anónima / company), the documented
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

/** Standalone, since no reference validator exists to reuse: the SAME formula `generatePtNif` above
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

// ─────────────────────────────────────────────────────────────────────────────
// Registry, keyed by the algorithm id a scheme's `demoGenerator.id` names
// ─────────────────────────────────────────────────────────────────────────────

export type DemoGeneratorParam = 'source' | 'prefix' | 'template';

export interface DemoGeneratorInput {
  rng: Rng;
  spec: DemoIdentifierGeneratorSpec;
  /** Values already generated for the same party, by scheme. */
  generated: ReadonlyMap<string, string>;
  variables: ReadonlyMap<string, string>;
}

export interface DemoIdentifierGenerator {
  params: readonly DemoGeneratorParam[];
  generate(input: DemoGeneratorInput): string;
}

const TEMPLATE_TOKEN = /\{(\w+)(?::(\w+))?\}/g;

export interface TemplateToken {
  name: string;
  modifier?: string;
}

export function templateTokens(template: string): TemplateToken[] {
  return [...template.matchAll(TEMPLATE_TOKEN)].map(([, name, modifier]) => ({ name, modifier }));
}

/** Throws unless the token can be rendered: `digits:N`, or a declared variable with an optional `lastN`. */
export function assertRenderableToken(token: TemplateToken, variableNames: ReadonlySet<string>): void {
  if (token.name === 'digits') {
    if (!/^[1-9]\d*$/.test(token.modifier ?? '')) throw new Error('{digits:N} needs a positive length');
    return;
  }
  if (!variableNames.has(token.name)) throw new Error(`template variable "${token.name}" is not declared`);
  if (token.modifier !== undefined && !/^last[1-9]\d*$/.test(token.modifier)) {
    throw new Error(`unknown template modifier "${token.modifier}" on "${token.name}"`);
  }
}

function renderTemplate({ rng, spec, variables }: DemoGeneratorInput): string {
  return (spec.template ?? '').replace(TEMPLATE_TOKEN, (_match, name: string, modifier?: string) => {
    if (name === 'digits') return digitsToString(randomDigits(rng, Number(modifier)));
    const value = variables.get(name) ?? '';
    return modifier ? value.slice(-Number(modifier.slice('last'.length))) : value;
  });
}

function sourceValue({ spec, generated }: DemoGeneratorInput): string {
  return generated.get(spec.source ?? '') ?? '';
}

export const DEMO_IDENTIFIER_GENERATORS: Readonly<Record<string, DemoIdentifierGenerator>> = {
  siret: { params: [], generate: ({ rng }) => generateSiret(rng) },
  'fr-vat-from-siren': {
    params: ['source'],
    generate: (input) => calculateFrenchVAT(sourceValue(input).slice(0, 9)),
  },
  'de-ust-idnr': { params: [], generate: ({ rng }) => generateDeVat(rng) },
  'it-partita-iva': { params: [], generate: ({ rng }) => generateItPartitaIva(rng) },
  'pl-nip': { params: [], generate: ({ rng }) => generatePlNip(rng) },
  'pt-nif': { params: [], generate: ({ rng }) => generatePtNif(rng) },
  'prefixed-copy': {
    params: ['prefix', 'source'],
    generate: (input) => `${input.spec.prefix}${sourceValue(input)}`,
  },
  template: { params: ['template'], generate: renderTemplate },
};

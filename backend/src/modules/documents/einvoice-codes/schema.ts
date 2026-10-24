/**
 * The codes a country's national e-invoice format requires where EN 16931 has none of its own: the
 * code that explains why a line carries no VAT, the seller's tax regime, and the recipient code used
 * when the buyer has no delivery channel on file. Every code carries the source that defines it.
 */
import {
  assertValidPolicyProvenance,
  InvalidPolicyProvenanceError,
  PolicyProvenance,
} from '../country-policy/schema';
import { TaxScheme } from '../tax/types';

const TAX_SCHEMES: readonly TaxScheme[] = ['STANDARD', 'FRANCHISE_BASE', 'EXEMPT'];

/** What selects an exemption code for an untaxed line. A code without `appliesTo` is declared as
 *  accepted by the format but nothing in an invoice can select it yet. */
export interface ExemptionCodeSelector {
  /** The exemption reason the tax engine resolved for the line (a VATEX code). */
  exemptionReasons?: string[];
  /** The seller's own tax scheme, for a line the engine left untaxed without a VATEX reason. */
  sellerTaxSchemes?: TaxScheme[];
  /** A `vatRates` entry id the seller picked for the line. */
  vatRateIds?: string[];
}

export interface ExemptionCodeFact {
  code: string;
  /** The legal basis printed next to the code on the document. */
  legalReference: string;
  appliesTo?: ExemptionCodeSelector;
  provenance: PolicyProvenance;
  notes?: string;
}

export interface TaxRegimeCodeFact {
  taxScheme: TaxScheme;
  code: string;
  provenance: PolicyProvenance;
  notes?: string;
}

export interface RecipientCodesFact {
  /** The buyer is reached by certified e-mail, or through no known channel. */
  withoutCode: string;
  /** The buyer is established abroad. */
  establishedAbroad: string;
  provenance: PolicyProvenance;
  notes?: string;
}

export interface CountryEinvoiceCodesFile {
  /** ISO 3166-1 alpha-2, uppercase, must match the file's own name (`countries/data/all.ts` checks it). */
  countryCode: string;
  exemptionCodes: ExemptionCodeFact[];
  taxRegimeCodes: TaxRegimeCodeFact[];
  recipientCodes: RecipientCodesFact;
  notes?: string;
}

export class InvalidEinvoiceCodesError extends InvalidPolicyProvenanceError {}

function assertCode(value: unknown, label: string, context: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidEinvoiceCodesError(`${context}: ${label} must be a non-empty string.`);
  }
}

function assertUnique(values: string[], label: string, context: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate !== undefined) {
    throw new InvalidEinvoiceCodesError(`${context}: ${label} "${duplicate}" is declared twice.`);
  }
}

function assertTaxScheme(value: unknown, context: string): void {
  if (!TAX_SCHEMES.includes(value as TaxScheme)) {
    throw new InvalidEinvoiceCodesError(
      `${context}: "${String(value)}" is not one of ${TAX_SCHEMES.join(', ')}.`,
    );
  }
}

function assertValidSelector(fact: ExemptionCodeFact, context: string): void {
  const selector = fact.appliesTo;
  if (!selector) return;
  const values = [
    ...(selector.exemptionReasons ?? []),
    ...(selector.sellerTaxSchemes ?? []),
    ...(selector.vatRateIds ?? []),
  ];
  if (values.length === 0) {
    throw new InvalidEinvoiceCodesError(`${context}: exemption code "${fact.code}" has an empty appliesTo.`);
  }
  for (const scheme of selector.sellerTaxSchemes ?? []) assertTaxScheme(scheme, `${context} ${fact.code}`);
}

/** Every selector value may point at one code only, or the code a line gets would depend on file order. */
function assertSelectorsDisjoint(facts: ExemptionCodeFact[], context: string): void {
  for (const key of ['exemptionReasons', 'sellerTaxSchemes', 'vatRateIds'] as const) {
    assertUnique(
      facts.flatMap((fact) => fact.appliesTo?.[key] ?? []),
      `appliesTo.${key} value`,
      context,
    );
  }
}

export function assertValidEinvoiceCodes(file: CountryEinvoiceCodesFile, context: string): void {
  if (!Array.isArray(file.exemptionCodes) || !Array.isArray(file.taxRegimeCodes)) {
    throw new InvalidEinvoiceCodesError(`${context}: declares no exemptionCodes or taxRegimeCodes array.`);
  }
  for (const fact of file.exemptionCodes) {
    assertCode(fact.code, 'an exemption code', context);
    assertCode(fact.legalReference, `exemption code "${fact.code}" legalReference`, context);
    assertValidSelector(fact, context);
    assertValidPolicyProvenance(
      fact.provenance,
      `${context} exemption code "${fact.code}"`,
      'an exemption code',
    );
  }
  assertUnique(
    file.exemptionCodes.map((fact) => fact.code),
    'exemption code',
    context,
  );
  assertSelectorsDisjoint(file.exemptionCodes, context);

  for (const fact of file.taxRegimeCodes) {
    assertTaxScheme(fact.taxScheme, `${context} taxRegimeCodes`);
    assertCode(fact.code, 'a tax regime code', context);
    assertValidPolicyProvenance(fact.provenance, `${context} tax regime "${fact.code}"`, 'a tax regime code');
  }
  assertUnique(
    file.taxRegimeCodes.map((fact) => fact.taxScheme),
    'tax scheme',
    context,
  );
  if (!file.taxRegimeCodes.some((fact) => fact.taxScheme === 'STANDARD')) {
    throw new InvalidEinvoiceCodesError(`${context}: declares no tax regime code for the STANDARD scheme.`);
  }

  const recipient = file.recipientCodes;
  if (!recipient) throw new InvalidEinvoiceCodesError(`${context}: declares no recipientCodes.`);
  assertCode(recipient.withoutCode, 'recipientCodes.withoutCode', context);
  assertCode(recipient.establishedAbroad, 'recipientCodes.establishedAbroad', context);
  assertValidPolicyProvenance(recipient.provenance, `${context} recipientCodes`, 'a recipient code');
}

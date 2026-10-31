/**
 * The `companyProfile` section of a country file: the facts about a seller that a country's rules
 * depend on and that only the company itself can declare (its size category, for instance). Each
 * attribute lists the values it may take; a company stores one value per attribute, or none.
 */
import { assertValidPolicyProvenance, PolicyProvenance } from '../country-policy/schema';

export interface CompanyProfileAttributeValue {
  value: string;
  label: string;
}

export interface CompanyProfileAttribute {
  key: string;
  label: string;
  help?: string;
  values: CompanyProfileAttributeValue[];
  /**
   * The value a RULE reads when the company has not answered this attribute. Never stored, never
   * shown as the company's answer: it exists so a country can pick the fail-closed side of an
   * unanswered question where the consequence of the other side cannot be walked back. A country
   * that omits it keeps the older behaviour, an undeclared attribute satisfies every condition.
   */
  assumedWhenUndeclared?: string;
  provenance: PolicyProvenance;
}

export interface CountryCompanyProfileFile {
  countryCode: string;
  attributes: CompanyProfileAttribute[];
}

/** A company's declared values, by attribute key. An absent key means "not declared". */
export type CompanyProfileValues = Record<string, string>;

/** A condition on a company profile: every listed attribute must take one of the listed values. */
export type ProfileCondition = Record<string, string[]>;

export class InvalidCompanyProfileError extends Error {}

const ATTRIBUTE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function assertValidAttribute(attribute: CompanyProfileAttribute, context: string, seen: Set<string>): void {
  const key = attribute?.key;
  if (!isNonBlankString(key) || !ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new InvalidCompanyProfileError(
      `${context}: an attribute has no valid "key" (camelCase, starting with a letter), got "${String(key)}".`,
    );
  }
  if (seen.has(key)) {
    throw new InvalidCompanyProfileError(`${context}: attribute "${key}" is declared twice.`);
  }
  seen.add(key);
  if (!isNonBlankString(attribute.label)) {
    throw new InvalidCompanyProfileError(`${context}: attribute "${key}" has no "label".`);
  }
  if (!Array.isArray(attribute.values) || attribute.values.length === 0) {
    throw new InvalidCompanyProfileError(`${context}: attribute "${key}" declares no "values".`);
  }
  const values = new Set<string>();
  for (const entry of attribute.values) {
    if (!isNonBlankString(entry?.value) || !isNonBlankString(entry?.label)) {
      throw new InvalidCompanyProfileError(
        `${context}: attribute "${key}" has a value with no "value" or no "label".`,
      );
    }
    if (values.has(entry.value)) {
      throw new InvalidCompanyProfileError(
        `${context}: attribute "${key}" lists value "${entry.value}" twice.`,
      );
    }
    values.add(entry.value);
  }
  if (attribute.assumedWhenUndeclared !== undefined && !values.has(attribute.assumedWhenUndeclared)) {
    throw new InvalidCompanyProfileError(
      `${context}: attribute "${key}" assumes "${attribute.assumedWhenUndeclared}" when undeclared, ` +
        'which is not one of its values.',
    );
  }
  assertValidPolicyProvenance(
    attribute.provenance,
    `${context}: attribute "${key}"`,
    'a company profile attribute',
  );
}

export function assertValidCompanyProfile(section: CountryCompanyProfileFile, context: string): void {
  if (!Array.isArray(section.attributes) || section.attributes.length === 0) {
    throw new InvalidCompanyProfileError(
      `${context}: "attributes" must be a non-empty array; omit the section when a country asks nothing.`,
    );
  }
  const seen = new Set<string>();
  for (const attribute of section.attributes) {
    assertValidAttribute(attribute, context, seen);
  }
}

/** The shape of a condition alone: a non-empty object of non-empty lists of non-blank strings. */
export function assertWellFormedProfileCondition(condition: unknown, context: string): void {
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
    throw new InvalidCompanyProfileError(`${context}: a seller condition must be an object.`);
  }
  const entries = Object.entries(condition as Record<string, unknown>);
  if (entries.length === 0) {
    throw new InvalidCompanyProfileError(`${context}: a seller condition names no attribute.`);
  }
  for (const [key, values] of entries) {
    if (!Array.isArray(values) || values.length === 0 || !values.every(isNonBlankString)) {
      throw new InvalidCompanyProfileError(
        `${context}: seller condition "${key}" must list at least one value, each a non-blank string.`,
      );
    }
  }
}

/** Every attribute and value a condition names must be declared by the same country's profile. */
export function assertProfileConditionIsDeclared(
  condition: ProfileCondition,
  profile: CountryCompanyProfileFile | undefined,
  context: string,
): void {
  for (const [key, values] of Object.entries(condition)) {
    const attribute = profile?.attributes.find((candidate) => candidate.key === key);
    if (!attribute) {
      throw new InvalidCompanyProfileError(
        `${context}: seller condition names attribute "${key}", which this country's "companyProfile" ` +
          'does not declare.',
      );
    }
    const unknown = values.find((value) => !attribute.values.some((entry) => entry.value === value));
    if (unknown !== undefined) {
      throw new InvalidCompanyProfileError(
        `${context}: seller condition "${key}" names value "${unknown}", which attribute "${key}" does not ` +
          `declare (expected one of ${attribute.values.map((entry) => entry.value).join(', ')}).`,
      );
    }
  }
}

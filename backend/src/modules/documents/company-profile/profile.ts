import { CompanyProfileAttribute, CompanyProfileValues } from './schema';

export class InvalidCompanyProfileValueError extends Error {}

/** The company settings an attribute can be derived from, read off the company's own row. */
export interface CompanyProfileSources {
  exemptVat: boolean;
}

/** Reads the stored JSON column back: only string values survive, anything else counts as undeclared. */
export function parseCompanyProfileValues(stored: unknown): CompanyProfileValues {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const values: CompanyProfileValues = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') values[key] = value;
  }
  return values;
}

/** The value an attribute takes without being asked, or `undefined` when the company decides it. */
export function derivedProfileValue(
  attribute: CompanyProfileAttribute,
  sources: CompanyProfileSources,
): string | undefined {
  if (!attribute.derived) return undefined;
  return sources.exemptVat ? attribute.derived.whenTrue : attribute.derived.whenFalse;
}

/** Every value the company's profile currently carries: the declared ones plus the derived ones. */
export function companyProfileValues(
  stored: unknown,
  attributes: CompanyProfileAttribute[],
  sources: CompanyProfileSources,
): CompanyProfileValues {
  const values: CompanyProfileValues = {};
  const declared = parseCompanyProfileValues(stored);
  for (const attribute of attributes) {
    const derived = derivedProfileValue(attribute, sources);
    if (derived !== undefined) values[attribute.key] = derived;
    else if (declared[attribute.key] !== undefined) values[attribute.key] = declared[attribute.key];
  }
  return values;
}

/**
 * Whether the country still needs this attribute answered. An attribute named by `askedWhen` and not
 * declared yet leaves the condition open, and an open condition keeps the question visible.
 */
export function isAttributeAsked(attribute: CompanyProfileAttribute, values: CompanyProfileValues): boolean {
  if (!attribute.askedWhen) return true;
  return Object.entries(attribute.askedWhen).every(([key, allowed]) => {
    const value = values[key];
    return value === undefined || allowed.includes(value);
  });
}

/**
 * Applies a write to the stored values. `null` or `""` for a key clears it back to undeclared; an
 * attribute the country does not declare, an attribute it derives, or a value the attribute does not
 * list, is refused.
 */
export function applyCompanyProfileInput(
  current: CompanyProfileValues,
  input: unknown,
  attributes: CompanyProfileAttribute[],
): CompanyProfileValues {
  if (input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidCompanyProfileValueError('reportingProfile must be an object of attribute values.');
  }
  const next: CompanyProfileValues = {};
  for (const [key, value] of Object.entries(current)) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (attribute && !attribute.derived) next[key] = value;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (!attribute) {
      throw new InvalidCompanyProfileValueError(
        `reportingProfile.${key} is not an attribute this company's country asks for` +
          (attributes.length
            ? ` (expected one of ${attributes.map((candidate) => candidate.key).join(', ')}).`
            : '; it asks for none.'),
      );
    }
    if (attribute.derived) {
      throw new InvalidCompanyProfileValueError(
        `reportingProfile.${key} follows from the company's own settings and cannot be declared.`,
      );
    }
    if (value === null || value === '') {
      delete next[key];
      continue;
    }
    if (typeof value !== 'string' || !attribute.values.some((entry) => entry.value === value)) {
      throw new InvalidCompanyProfileValueError(
        `reportingProfile.${key} must be one of ${attribute.values.map((entry) => entry.value).join(', ')}, ` +
          `not ${JSON.stringify(value)}.`,
      );
    }
    next[key] = value;
  }
  return next;
}

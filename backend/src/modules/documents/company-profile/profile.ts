import { CompanyProfileAttribute, CompanyProfileValues } from './schema';

export class InvalidCompanyProfileValueError extends Error {}

/** The values a RULE reads for this country: each unanswered attribute that declares an assumption
 *  takes it, every answered one is kept. The stored column is never rewritten by this. */
export function withAssumedValues(
  profile: CompanyProfileValues,
  attributes: CompanyProfileAttribute[],
): CompanyProfileValues {
  const resolved = { ...profile };
  for (const attribute of attributes) {
    if (resolved[attribute.key] === undefined && attribute.assumedWhenUndeclared !== undefined) {
      resolved[attribute.key] = attribute.assumedWhenUndeclared;
    }
  }
  return resolved;
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

/**
 * Applies a write to the stored values. `null` or `""` for a key clears it back to undeclared; an
 * attribute the country does not declare, or a value the attribute does not list, is refused.
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
    if (attributes.some((attribute) => attribute.key === key)) next[key] = value;
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

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

/** The values the company's own settings derive, by attribute key. */
function derivedProfileValues(
  attributes: CompanyProfileAttribute[],
  sources: CompanyProfileSources,
): CompanyProfileValues {
  const values: CompanyProfileValues = {};
  for (const attribute of attributes) {
    const derived = derivedProfileValue(attribute, sources);
    if (derived !== undefined) values[attribute.key] = derived;
  }
  return values;
}

/**
 * Every value the company's profile currently carries: the derived ones plus the declared ones whose
 * `askedWhen` still holds. A stored answer the country no longer asks for (its condition stopped
 * holding when another value changed) is not part of the profile, so it is never read back nor
 * exported; the next write drops it too.
 */
export function companyProfileValues(
  stored: unknown,
  attributes: CompanyProfileAttribute[],
  sources: CompanyProfileSources,
): CompanyProfileValues {
  const derived = derivedProfileValues(attributes, sources);
  const declared = parseCompanyProfileValues(stored);
  const context = { ...declared, ...derived };
  const values: CompanyProfileValues = { ...derived };
  for (const [key, value] of Object.entries(declared)) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (!attribute || attribute.derived) continue;
    if (!isAttributeAsked(attribute, context)) continue;
    values[key] = value;
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

/** How an unmet `askedWhen` reads in an error: the attributes and values the country requires. */
function describeAskedWhen(attribute: CompanyProfileAttribute): string {
  return Object.entries(attribute.askedWhen ?? {})
    .map(([key, allowed]) => `${key} one of ${allowed.join(', ')}`)
    .join(' and ');
}

/**
 * Applies a write to the stored values. `null` or `""` for a key clears it back to undeclared; an
 * attribute the country does not declare, an attribute it derives, a value the attribute does not
 * list, or a value for a question the company's own values no longer make relevant (its `askedWhen`
 * does not hold), is refused.
 */
export function applyCompanyProfileInput(
  current: CompanyProfileValues,
  input: unknown,
  attributes: CompanyProfileAttribute[],
  sources: CompanyProfileSources,
): CompanyProfileValues {
  if (input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidCompanyProfileValueError('reportingProfile must be an object of attribute values.');
  }
  const declared: CompanyProfileValues = {};
  const touched = new Set<string>();
  for (const [key, value] of Object.entries(current)) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (attribute && !attribute.derived) declared[key] = value;
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
      delete declared[key];
      continue;
    }
    if (typeof value !== 'string' || !attribute.values.some((entry) => entry.value === value)) {
      throw new InvalidCompanyProfileValueError(
        `reportingProfile.${key} must be one of ${attribute.values.map((entry) => entry.value).join(', ')}, ` +
          `not ${JSON.stringify(value)}.`,
      );
    }
    declared[key] = value;
    touched.add(key);
  }
  const context = { ...declared, ...derivedProfileValues(attributes, sources) };
  for (const key of touched) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (!attribute || isAttributeAsked(attribute, context)) continue;
    throw new InvalidCompanyProfileValueError(
      `reportingProfile.${key} is asked only when ${describeAskedWhen(attribute)}, ` +
        `which the company's own values do not satisfy.`,
    );
  }
  const next: CompanyProfileValues = {};
  for (const [key, value] of Object.entries(declared)) {
    const attribute = attributes.find((candidate) => candidate.key === key);
    if (attribute && isAttributeAsked(attribute, context)) next[key] = value;
  }
  return next;
}

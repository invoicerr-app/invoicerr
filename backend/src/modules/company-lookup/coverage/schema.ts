/**
 * What the company lookup knows about one country: which registry providers serve it, and the note
 * that tells the user what the lookup there is limited to. A country with its own
 * `documents/countries/data/<cc>.json` declares it in that file's `companyLookup` section; every
 * other country is an entry of `company-lookup/data/coverage.json`. The worldwide directories are
 * never listed here, they serve every country.
 */
export interface CompanyLookupFacts {
  /** Provider ids, in the order they are tried, before the worldwide directories. */
  providers?: string[];
  /** Frontend i18n key of the note shown with this country's lookup. */
  noteKey?: string;
}

export interface CountryCompanyLookupSection extends CompanyLookupFacts {
  countryCode: string;
}

export class InvalidCompanyLookupFactsError extends Error {}

const PROVIDER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOTE_KEY = /^companyLookup\.notes\.[A-Za-z0-9]+$/;
const KNOWN_KEYS = new Set(['countryCode', 'providers', 'noteKey']);

function fail(context: string, message: string): never {
  throw new InvalidCompanyLookupFactsError(`${context}: ${message}`);
}

export function assertValidCompanyLookupFacts(facts: CompanyLookupFacts, context: string): void {
  if (!facts || typeof facts !== 'object') fail(context, 'company lookup facts must be an object.');
  const unknown = Object.keys(facts).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) fail(context, `unknown company lookup key(s) ${unknown.join(', ')}.`);
  const { providers, noteKey } = facts;
  if (providers !== undefined) {
    if (!Array.isArray(providers) || providers.length === 0) {
      fail(context, '"providers" must be a non-empty array when present.');
    }
    for (const id of providers) {
      if (typeof id !== 'string' || !PROVIDER_ID.test(id)) fail(context, `"${id}" is not a provider id.`);
    }
    if (new Set(providers).size !== providers.length) fail(context, '"providers" lists a provider twice.');
  }
  if (noteKey !== undefined && (typeof noteKey !== 'string' || !NOTE_KEY.test(noteKey))) {
    fail(context, `"noteKey" must match ${NOTE_KEY}.`);
  }
  if (providers === undefined && noteKey === undefined) {
    fail(context, 'declares no company lookup fact.');
  }
}

/**
 * Every country's company lookup facts (see `./schema.ts`), merged from the shipped country files and
 * the generic `../data/coverage.json`. A country may appear in only one of the two.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ComposedCountryCatalog,
  defaultComposedCountryCatalog,
} from '@/modules/documents/countries/registry';
import { assertValidCompanyLookupFacts, CompanyLookupFacts, InvalidCompanyLookupFactsError } from './schema';

export interface CompanyLookupCoverageFile {
  countries: Record<string, CompanyLookupFacts>;
}

const GENERIC_CONTEXT = 'company-lookup/data/coverage.json';
const COUNTRY_CODE = /^[A-Z]{2}$/;

function fromCountryFiles(catalog: ComposedCountryCatalog): Record<string, CompanyLookupFacts> {
  const facts: Record<string, CompanyLookupFacts> = {};
  for (const code of catalog.countries()) {
    const section = catalog.get(code)?.companyLookup;
    if (!section) continue;
    const { countryCode: _countryCode, ...rest } = section;
    facts[code] = rest;
  }
  return facts;
}

/** Merges both sources, refusing a generic entry for a country that has a file of its own. */
export function mergeCompanyLookupFacts(
  file: CompanyLookupCoverageFile,
  catalog: ComposedCountryCatalog,
): Record<string, CompanyLookupFacts> {
  const merged = fromCountryFiles(catalog);
  for (const [code, facts] of Object.entries(file?.countries ?? {})) {
    const context = `${GENERIC_CONTEXT}#${code}`;
    if (!COUNTRY_CODE.test(code)) {
      throw new InvalidCompanyLookupFactsError(`${context}: not an uppercase 2-letter country code.`);
    }
    if (catalog.has(code)) {
      throw new InvalidCompanyLookupFactsError(
        `${context}: ${code} has its own country file, declare its "companyLookup" section there instead.`,
      );
    }
    assertValidCompanyLookupFacts(facts, context);
    merged[code] = facts;
  }
  return merged;
}

function loadGenericFile(): CompanyLookupCoverageFile {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'data', 'coverage.json'), 'utf-8'),
  ) as CompanyLookupCoverageFile;
}

export class CompanyLookupCoverage {
  private readonly facts: Record<string, CompanyLookupFacts>;

  constructor(facts: Record<string, CompanyLookupFacts>) {
    this.facts = facts;
  }

  static load(
    file: CompanyLookupCoverageFile = loadGenericFile(),
    catalog: ComposedCountryCatalog = defaultComposedCountryCatalog,
  ): CompanyLookupCoverage {
    return new CompanyLookupCoverage(mergeCompanyLookupFacts(file, catalog));
  }

  /** Every country with at least one fact, sorted. */
  countries(): string[] {
    return Object.keys(this.facts).sort((a, b) => a.localeCompare(b));
  }

  factsFor(countryCode: string): CompanyLookupFacts | undefined {
    return this.facts[(countryCode ?? '').toUpperCase()];
  }

  providersFor(countryCode: string): readonly string[] {
    return this.factsFor(countryCode)?.providers ?? [];
  }

  serves(providerId: string, countryCode: string): boolean {
    return this.providersFor(countryCode).includes(providerId);
  }
}

export const defaultLookupCoverage = CompanyLookupCoverage.load();

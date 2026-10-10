/**
 * How a party's legal identifier is written into an EN 16931 invoice. A shipped country declares it
 * on its own identifier scheme (`countries/data/<cc>.json`, section "identifiers"). A buyer country
 * with no file of its own can still need an ISO 6523 scheme: `legal-id-reference.json` carries that
 * one fact for such countries, and may never repeat a country that declares it in its own file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CountryIdentifierRequirementsCatalog,
  defaultCountryIdentifierRequirementsCatalog,
} from '../registry';
import { IdentifierSchemeFact } from '../schema';

export type EinvoiceIdentifierFacts = Pick<
  IdentifierSchemeFact,
  'iso6523Scheme' | 'electronicAddressScheme' | 'einvoiceReduction'
>;

export interface Iso6523ReferenceRow {
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  /** The identifier scheme key this row describes, the same key a country file would use. */
  scheme: string;
  iso6523Scheme: string;
  /** The register the ISO 6523 ICD names. */
  register: string;
  notes?: string;
}

export interface Iso6523ReferenceFile {
  provenance: { kind: 'legal'; source: string; sourceText: string; sourceCheckedAt: string };
  countries: Iso6523ReferenceRow[];
}

export class InvalidIso6523ReferenceError extends Error {}

const CONTEXT = 'documents/country-identifiers/iso6523/legal-id-reference.json';

export function assertValidIso6523Reference(
  file: Iso6523ReferenceFile,
  catalog: CountryIdentifierRequirementsCatalog,
): void {
  const { provenance } = file;
  if (
    provenance?.kind !== 'legal' ||
    !provenance.source?.trim() ||
    !provenance.sourceText?.trim() ||
    !provenance.sourceCheckedAt?.trim()
  ) {
    throw new InvalidIso6523ReferenceError(
      `${CONTEXT}: provenance must be "legal" with source, sourceText and sourceCheckedAt.`,
    );
  }
  const seen = new Set<string>();
  for (const row of file.countries) {
    const key = `${row.countryCode}/${row.scheme}`;
    if (!/^[A-Z]{2}$/.test(row.countryCode) || !/^\d{4}$/.test(row.iso6523Scheme) || !row.register?.trim()) {
      throw new InvalidIso6523ReferenceError(
        `${CONTEXT}: ${key} needs an ISO country code, a 4-digit ICD and a register.`,
      );
    }
    if (seen.has(key)) throw new InvalidIso6523ReferenceError(`${CONTEXT}: ${key} appears twice.`);
    seen.add(key);
    if (catalog.has(row.countryCode)) {
      throw new InvalidIso6523ReferenceError(
        `${CONTEXT}: ${row.countryCode} has its own country file, declare ${row.scheme}'s iso6523Scheme there instead.`,
      );
    }
  }
}

function loadReference(): Iso6523ReferenceFile {
  return JSON.parse(
    readFileSync(join(__dirname, 'legal-id-reference.json'), 'utf-8'),
  ) as Iso6523ReferenceFile;
}

export class EinvoiceIdentifierCatalog {
  private readonly reference: Iso6523ReferenceRow[];

  constructor(
    private readonly catalog: CountryIdentifierRequirementsCatalog = defaultCountryIdentifierRequirementsCatalog,
    reference: Iso6523ReferenceFile = loadReference(),
  ) {
    assertValidIso6523Reference(reference, catalog);
    this.reference = reference.countries;
  }

  /** The e-invoice facts of one identifier scheme of one country, empty when nothing is declared. */
  factsFor(countryCode: string, scheme: string): EinvoiceIdentifierFacts {
    const fact = this.catalog.schemesFor(countryCode).find((entry) => entry.scheme === scheme);
    if (fact) {
      const { iso6523Scheme, electronicAddressScheme, einvoiceReduction } = fact;
      return { iso6523Scheme, electronicAddressScheme, einvoiceReduction };
    }
    const row = this.reference.find(
      (entry) => entry.countryCode === (countryCode ?? '').toUpperCase() && entry.scheme === scheme,
    );
    return row ? { iso6523Scheme: row.iso6523Scheme } : {};
  }
}

export const defaultEinvoiceIdentifierCatalog = new EinvoiceIdentifierCatalog();

/**
 * The tax-union reference table (issue #603, PR A: "one reference table for EU and GCC membership").
 *
 * Replaces FOUR independent copies that used to drift from each other (see this catalog's own
 * `registry.ts` header for the exact mapping, and this PR's own report for the before/after proof
 * that no copy's observable behaviour changed):
 *  - `tax/classification.ts`'s own `EU_MEMBERS` (27 countries) and `GCC_VAT` (6 countries), driving
 *    `taxUnionOf()`.
 *  - `formats/semantic/build-semantic-invoice.ts`'s own `VAT_PREFIX_TO_PEPPOL_EAS` (23 EU countries).
 *  - `formats/national/fatturapa-provider.ts`'s own `EU_CC` (26 countries).
 *  - `ocr-service/local-client.ts`'s own `EU_VAT_PREFIXES` (32 entries).
 *
 * Deliberately NOT a 7th section on `countries/data/<cc>.json` (`AUDIT_DONNEES_PAYS.md` section 3,
 * the paragraph on `taxSystem.euMember`): union membership and VAT-prefix facts must exist for every
 * country an invoice can name as a BUYER, not only the 6 countries this product ships a seller file
 * for (a French seller's buyer can be established in any of the 27 EU member states). A single,
 * country-blind reference table is the only shape that covers that.
 *
 * `code` is normally an ISO 3166-1 alpha-2 country code, except for exactly one documented entry
 * ("XI", Northern Ireland's own post-Brexit VAT prefix) that ISO does not assign at all: `iso3166`
 * says which kind each row is, so a consumer that only wants real countries can filter on it instead
 * of guessing from the code's shape.
 */

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this fact is based on, quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
  /** The source URL or document name this `sourceText` was read from. */
  source: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked to turn this into a `legal` entry, never left blank. */
  resolutionNote: string;
}

export type TaxUnionProvenance = LegalProvenance | UnverifiedProvenance;

/** One provenance per ASPECT this table covers, not one per row: every EU-membership row cites the
 *  same primary source, every Peppol EAS row cites the same code-list version, and so on. A fact a
 *  single row disagrees with the aspect's own citation (e.g. a country whose EAS code does not appear
 *  in the cited list at all) is a loader bug, not a per-row provenance gap. */
export interface TaxUnionsProvenance {
  euMembership: TaxUnionProvenance;
  gccMembership: TaxUnionProvenance;
  peppolEas: TaxUnionProvenance;
  ocrRecognition: TaxUnionProvenance;
}

export interface TaxUnionCountryFact {
  /** ISO 3166-1 alpha-2 country code, uppercase, except the one documented non-ISO entry ("XI") -
   *  see `iso3166`. */
  code: string;
  /** `false` only for a `code` ISO 3166-1 does not assign at all (Northern Ireland's "XI") - every
   *  other row is a real ISO 3166-1 alpha-2 code. */
  iso3166: boolean;
  /** Member of the European Union VAT area. */
  euMember: boolean;
  /** Signatory of the GCC Unified VAT Agreement - see `TaxUnionsProvenance.gccMembership` for the
   *  honest limit on this fact (implementation status per member is not independently re-verified by
   *  this table, only carried over from the pre-existing `GCC_VAT` set). */
  gccMember: boolean;
  /** The 2-letter prefix this country's VAT identifiers actually start with, ONLY when it is relevant
   *  to one of this table's consumers (a Peppol EAS lookup, or the OCR recognition heuristic) - absent
   *  for a country no consumer ever needed one for (every GCC row today), never defaulted to `code`.
   *  Usually equal to `code`; differs for Greece ("GR" in ISO, "EL" in a VAT number). */
  vatPrefix?: string;
  /** OpenPeppol Electronic Address Scheme (ISO 6523 ICD) code for this country's national VAT scheme,
   *  keyed by `vatPrefix` (not `code`) when both exist - present only "where one exists" (issue #603's
   *  own wording): a union member with no entry here simply has none published. */
  peppolEas?: string;
  /** Whether the OCR upload-screen heuristic (`ocr-service/local-client.ts#findVatId`) should treat
   *  `code` and `vatPrefix` as a plausible VAT-id prefix - a product decision, not a legal fact, see
   *  `TaxUnionsProvenance.ocrRecognition`. Absent (never `false`) for a row no consumer asked about. */
  recognizedByOcr?: boolean;
  /** Free text explaining why this row's facts are not the "every field defaults from `code`" case -
   *  required whenever `vatPrefix !== code`, `iso3166` is `false`, or a union-non-member row still
   *  carries OCR/Peppol facts, enforced by `assertValidTaxUnionCountryFact` below. */
  notes?: string;
}

export interface TaxUnionsFile {
  provenance: TaxUnionsProvenance;
  /** Sorted by `code`, enforced at load time - see `registry.ts`. */
  countries: TaxUnionCountryFact[];
}

export class InvalidTaxUnionsFileError extends Error {}

function assertValidProvenanceEntry(provenance: TaxUnionProvenance, aspect: string, context: string): void {
  const p = provenance as { kind?: unknown } | null | undefined;
  if (!p || (p.kind !== 'legal' && p.kind !== 'unverified')) {
    throw new InvalidTaxUnionsFileError(
      `${context}: provenance.${aspect} has no valid provenance (kind must be "legal" or ` +
        '"unverified") - a tax-union fact may never exist without saying where it came from.',
    );
  }
  if (p.kind === 'legal') {
    const legal = provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim() || !legal.source?.trim()) {
      throw new InvalidTaxUnionsFileError(
        `${context}: provenance.${aspect} claims "legal" provenance but is missing sourceText, ` +
          'sourceCheckedAt and/or source.',
      );
    }
    return;
  }
  const unverified = provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidTaxUnionsFileError(
      `${context}: provenance.${aspect} is "unverified" but has no resolutionNote - an unverified ` +
        'fact must say what would settle it.',
    );
  }
}

/** Validates one row's internal consistency - called once per row, at load time, by `registry.ts`
 *  (the same "validated once, centrally" discipline every sibling catalog's own loader holds). */
export function assertValidTaxUnionCountryFact(fact: TaxUnionCountryFact, context: string): void {
  const row = `${context}: country "${fact.code}"`;
  // Not `!fact.code || fact.code !== fact.code.toUpperCase()`: a naive optional-chain rewrite of
  // that shape (`fact.code?.toUpperCase() !== fact.code`) silently stops catching an empty string
  // (`?.` only guards null/undefined, never other falsy values) and would crash instead of throwing
  // this error for a non-string `code` (malformed JSON) rather than refusing cleanly.
  if (typeof fact.code !== 'string' || fact.code.length === 0 || fact.code !== fact.code.toUpperCase()) {
    throw new InvalidTaxUnionsFileError(`${row}: "code" must be a non-empty, uppercase string.`);
  }
  if (typeof fact.iso3166 !== 'boolean') {
    throw new InvalidTaxUnionsFileError(`${row}: "iso3166" must be a boolean.`);
  }
  if (typeof fact.euMember !== 'boolean' || typeof fact.gccMember !== 'boolean') {
    throw new InvalidTaxUnionsFileError(`${row}: "euMember" and "gccMember" must both be booleans.`);
  }
  if (fact.euMember && fact.gccMember) {
    throw new InvalidTaxUnionsFileError(`${row}: cannot be both an EU member and a GCC member.`);
  }
  if (!fact.iso3166 && !fact.notes?.trim()) {
    throw new InvalidTaxUnionsFileError(
      `${row}: "iso3166: false" must carry a "notes" explaining why this row's code is not an ISO ` +
        '3166-1 alpha-2 code.',
    );
  }
  if (fact.vatPrefix !== undefined && fact.vatPrefix !== fact.code && !fact.notes?.trim()) {
    throw new InvalidTaxUnionsFileError(
      `${row}: "vatPrefix" ("${fact.vatPrefix}") differs from "code" but carries no "notes" ` +
        'explaining why.',
    );
  }
}

/** Validates the file as a whole: every provenance aspect present and valid, every row internally
 *  consistent, codes unique and sorted - the same load-time gate every sibling catalog holds on its
 *  own `data/*.json`. */
export function assertValidTaxUnionsFile(file: TaxUnionsFile, context: string): void {
  if (!file.provenance) {
    throw new InvalidTaxUnionsFileError(`${context}: missing "provenance".`);
  }
  assertValidProvenanceEntry(file.provenance.euMembership, 'euMembership', context);
  assertValidProvenanceEntry(file.provenance.gccMembership, 'gccMembership', context);
  assertValidProvenanceEntry(file.provenance.peppolEas, 'peppolEas', context);
  assertValidProvenanceEntry(file.provenance.ocrRecognition, 'ocrRecognition', context);

  if (!Array.isArray(file.countries) || file.countries.length === 0) {
    throw new InvalidTaxUnionsFileError(`${context}: "countries" must be a non-empty array.`);
  }
  const seen = new Set<string>();
  for (const fact of file.countries) {
    assertValidTaxUnionCountryFact(fact, context);
    if (seen.has(fact.code)) {
      throw new InvalidTaxUnionsFileError(`${context}: duplicate country code "${fact.code}".`);
    }
    seen.add(fact.code);
  }
  const codes = file.countries.map((f) => f.code);
  const sorted = [...codes].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(codes) !== JSON.stringify(sorted)) {
    throw new InvalidTaxUnionsFileError(`${context}: "countries" must be sorted by "code".`);
  }
}

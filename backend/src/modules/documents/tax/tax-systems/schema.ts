/**
 * The country TAX-SYSTEM catalog — root TODO item 16's own input for the seller's (and, when known,
 * the buyer's) `CountryTaxSystemProfile` (`../types.ts`). Same "a country is data" shape as
 * `vat-rates/schema.ts` and `country-identifiers/schema.ts`, for a DIFFERENT concern: not what a user
 * picks from a dropdown (`vat-rates/`), but what the CROSS-BORDER TAX ENGINE (`../tax-engine.ts`)
 * assumes about a country's rate structure — its kind (VAT/GST/SALES_TAX/NONE), its standard/reduced
 * rates, and (France only, sourced) whether it has a domestic zero rate at all.
 *
 * REPRISE, not a fresh guess: every value here is read from the removed compliance engine's own
 * `CountryComplianceProfile.taxSystem` (git tag `avant-refonte-documents:backend/src/compliance/
 * profiles/data/{fr,us,it}.ts` and `.../archetypes.ts` for SA/AE/IN/QA, all built from the same
 * `vat()`/`gst()`/`noTax()` helpers) — see each `data/*.json` file's own `provenance` for exactly
 * which repère line it was read from and what a real citation would still need.
 *
 * DELIBERATE NON-DUPLICATION: France's own rate LADDER (20/10/5.5/2.1) is not re-typed here — it is
 * DERIVED from `vat-rates/registry.ts` at load time (`from-vat-rates.ts`), the same way the repère's
 * OWN `tax-rates/consistency.spec.ts` existed only to catch the two catalogs drifting apart. Deriving
 * instead of duplicating makes that whole category of drift structurally impossible for any country
 * whose vat-rates catalog is the primary source. `hasDomesticZeroRate` and `schemes` are the two facts
 * `vat-rates/` cannot derive (a rate ladder does not say whether ONE of its own entries constitutes a
 * true zero-RATED (not exempt) supply, nor which VAT SCHEMES — franchise-en-base, standard — a seller
 * in that country can hold) — those stay in this catalog's own JSON, sourced independently.
 */

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this fact is based on — quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked to turn this into a `legal` entry — never left blank, same
   *  discipline as every other `UnverifiedProvenance` in this module family. */
  resolutionNote: string;
}

export type TaxSystemProvenance = LegalProvenance | UnverifiedProvenance;

export type CountryTaxSystemKind = 'VAT' | 'GST' | 'SALES_TAX' | 'NONE';

export interface CountryTaxSystemFact {
  countryCode: string; // ISO 3166-1 alpha-2, uppercase — must match the file's own name
  kind: CountryTaxSystemKind;
  /** VAT/GST only. When omitted for a VAT/GST country, `registry.ts` derives it from
   *  `vat-rates/registry.ts`'s own STANDARD-category entry for the same country (see this file's own
   *  header, "DELIBERATE NON-DUPLICATION") — an explicit value here is only needed for a country
   *  `vat-rates/` does not catalog at all (Italy, Saudi Arabia, the UAE, India, Qatar today). */
  standardRate?: number;
  reducedRates?: number[];
  /** France only, sourced — see `data/fr.json`. Absent (not `false`) for every other country: "not
   *  established", never a guessed `true`. */
  hasDomesticZeroRate?: boolean;
  schemes?: ('STANDARD' | 'FRANCHISE_BASE' | 'EXEMPT')[];
  /** SALES_TAX only (`kind: 'SALES_TAX'`, the United States today). */
  stateRates?: Record<string, number>;
  nexusSubdivisions?: string[];
  provenance: TaxSystemProvenance;
  notes?: string;
}

export class InvalidTaxSystemProvenanceError extends Error {}

export function assertValidTaxSystemProvenance(fact: CountryTaxSystemFact, context: string): void {
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidTaxSystemProvenanceError(
      `${context}: tax-system fact for "${fact.countryCode}" has no valid provenance (kind must be ` +
        '"legal" or "unverified") — a country tax-system fact may never exist without saying where ' +
        'it came from.',
    );
  }
  if (provenance.kind === 'legal') {
    const legal = fact.provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidTaxSystemProvenanceError(
        `${context}: tax-system fact for "${fact.countryCode}" claims "legal" provenance but is ` +
          'missing sourceText and/or sourceCheckedAt.',
      );
    }
    return;
  }
  const unverified = fact.provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidTaxSystemProvenanceError(
      `${context}: tax-system fact for "${fact.countryCode}" is "unverified" but has no ` +
        'resolutionNote — an unverified fact must say what would settle it.',
    );
  }
}

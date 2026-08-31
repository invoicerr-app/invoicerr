import { defaultVatRateCatalog, VatRateCatalog } from '../../vat-rates/registry';
import { CountryTaxSystemProfile, TaxSystemSpec } from '../types';
import { ALL_TAX_SYSTEM_FILES } from './data/all';
import { CountryTaxSystemFact } from './schema';

function buildIndex(files: CountryTaxSystemFact[]): Record<string, CountryTaxSystemFact> {
  const index: Record<string, CountryTaxSystemFact> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * Derives `standardRate`/`reducedRates` from `vat-rates/registry.ts` for a country whose fact did not
 * declare them explicitly — see `schema.ts`'s own header, "DELIBERATE NON-DUPLICATION". A `STANDARD`
 * category entry becomes `standardRate`; every `REDUCED`/`SUPER_REDUCED` entry becomes a member of
 * `reducedRates` (descending, matching the repère's own `[10, 5.5, 2.1]` ordering for France).
 * Returns `undefined` when no `STANDARD` entry exists in the vat-rates catalog for this country — the
 * caller then has nothing to fall back to beyond an EXPLICIT rate on the fact itself.
 */
function deriveRatesFromVatCatalog(
  countryCode: string,
  catalog: VatRateCatalog,
): { standardRate: number; reducedRates: number[] } | undefined {
  const rates = catalog.ratesFor(countryCode);
  const standard = rates.find((r) => r.category === 'STANDARD');
  if (!standard) return undefined;
  const reduced = rates
    .filter((r) => r.category === 'REDUCED' || r.category === 'SUPER_REDUCED')
    .map((r) => r.rate)
    .sort((a, b) => b - a);
  return { standardRate: standard.rate, reducedRates: reduced };
}

function toTaxSystemSpec(fact: CountryTaxSystemFact, catalog: VatRateCatalog): TaxSystemSpec {
  if (fact.kind === 'NONE') return { kind: 'NONE' };
  if (fact.kind === 'SALES_TAX') {
    return {
      kind: 'SALES_TAX',
      stateRates: fact.stateRates ?? {},
      nexusSubdivisions: fact.nexusSubdivisions,
    };
  }
  const derived =
    fact.standardRate === undefined ? deriveRatesFromVatCatalog(fact.countryCode, catalog) : undefined;
  const standardRate = fact.standardRate ?? derived?.standardRate;
  if (standardRate === undefined) {
    throw new Error(
      `tax-systems/data/${fact.countryCode.toLowerCase()}.json declares kind "${fact.kind}" with no ` +
        `standardRate, and vat-rates/ has no STANDARD-category catalog for "${fact.countryCode}" to ` +
        'derive one from — a VAT/GST country must have a standard rate from one source or the other.',
    );
  }
  return {
    kind: fact.kind,
    standardRate,
    reducedRates: fact.reducedRates ?? derived?.reducedRates ?? [],
    schemes: fact.schemes ?? ['STANDARD'],
    hasDomesticZeroRate: fact.hasDomesticZeroRate,
  };
}

/**
 * In-memory view of the tax-system catalog — the same role `vat-rates/registry.ts`'s `VatRateCatalog`
 * and `country-identifiers/registry.ts` play for their own concerns. `resolve-invoice-tax.ts` is the
 * one consumer: it resolves the SELLER's profile (must exist — see that file's own guard) and,
 * OPTIONALLY, the BUYER's (a missing buyer profile is exactly the "no destination rate table" fact
 * that makes an OSS sale to an uncatalogued country a NAMED block rather than a guess).
 */
export class TaxSystemRegistry {
  private readonly files: Record<string, CountryTaxSystemFact>;

  constructor(
    files: CountryTaxSystemFact[] = ALL_TAX_SYSTEM_FILES,
    private readonly vatRateCatalog: VatRateCatalog = defaultVatRateCatalog,
  ) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** `undefined` for a country with no known tax-system fact — deliberately NOT a fallback profile,
   *  the same "no permissive default" every sibling registry in this module family holds. */
  resolve(countryCode: string): CountryTaxSystemProfile | undefined {
    const fact = this.files[(countryCode ?? '').toUpperCase()];
    if (!fact) return undefined;
    return { countryCode: fact.countryCode, taxSystem: toTaxSystemSpec(fact, this.vatRateCatalog) };
  }
}

export const defaultTaxSystemRegistry = new TaxSystemRegistry();

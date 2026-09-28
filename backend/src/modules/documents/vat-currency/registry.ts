import { ALL_VAT_CURRENCY_FILES } from './data/all';
import { CountryVatCurrencyFile, VatCurrencyRule } from './schema';

function buildIndex(files: CountryVatCurrencyFile[]): Record<string, CountryVatCurrencyFile> {
  const index: Record<string, CountryVatCurrencyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the VAT-currency rule files, the same role `ContentRequirementCatalog`
 * (`../content-requirements/registry.ts`) plays for its own country-is-data concern, and the same
 * reason it is never mirrored into a database: a rule's effect costs nothing to re-read straight from
 * these files on every build, and there is no per-request performance case here that would justify a
 * `country-policy/`-style table.
 */
export class VatCurrencyCatalog {
  private readonly files: Record<string, CountryVatCurrencyFile>;

  constructor(files: CountryVatCurrencyFile[] = ALL_VAT_CURRENCY_FILES) {
    this.files = buildIndex(files);
  }

  /** The rule for a country, or `null` for one this catalog has no file for at all, see
   *  `data/all.ts`'s own header for why that is a permissive "nothing to do here", never a block. */
  ruleFor(countryCode: string): VatCurrencyRule | null {
    return this.files[(countryCode ?? '').toUpperCase()]?.rule ?? null;
  }
}

export const defaultVatCurrencyCatalog = new VatCurrencyCatalog();

/** Convenience wrapper over the default catalog, the one nearly every caller actually wants (the
 *  same "module-level singleton + thin function" convention `vat-rates/registry.ts#findVatRateById`
 *  already holds), a constructible `VatCurrencyCatalog` staying available for a test that wants a
 *  narrower fixture. */
export function resolveVatCurrencyRule(countryCode: string): VatCurrencyRule | null {
  return defaultVatCurrencyCatalog.ruleFor(countryCode);
}

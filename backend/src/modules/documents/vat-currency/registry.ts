import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryVatCurrencyFile, VatCurrencyRule } from './schema';

function buildIndex(files: CountryVatCurrencyFile[]): Record<string, CountryVatCurrencyFile> {
  const index: Record<string, CountryVatCurrencyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `vatCurrency` section from
 * the composed per-country view, instead of this catalog's own `data/all.ts` directly. No import
 * cycle results, because `countries/compose.ts` reads the RAW loader (`vat-currency/data/all.ts`'s
 * own `ALL_VAT_CURRENCY_FILES`), never this registry: see that file's own header. The dependency
 * direction is therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `vat-currency/data/all.ts`; nothing depends back on this
 * file from inside that chain. A country with no `vatCurrency` section in the composed view is
 * simply left out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_VAT_CURRENCY_FILES` directly.
 */
function vatCurrencyFromComposedCatalog(): CountryVatCurrencyFile[] {
  const files: CountryVatCurrencyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const vatCurrency = defaultComposedCountryCatalog.get(countryCode)?.vatCurrency;
    if (vatCurrency) files.push(vatCurrency);
  }
  return files;
}

/**
 * In-memory view of the VAT-currency rule files, the same role `ContentRequirementCatalog`
 * (`../content-requirements/registry.ts`) plays for its own country-is-data concern, and the same
 * reason it is never mirrored into a database: a rule's effect costs nothing to re-read straight from
 * these files on every build, and there is no per-request performance case here that would justify a
 * `country-policy/`-style table.
 *
 * The constructor still takes a plain `CountryVatCurrencyFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new VatCurrencyCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where it
 * reads from.
 */
export class VatCurrencyCatalog {
  private readonly files: Record<string, CountryVatCurrencyFile>;

  constructor(files: CountryVatCurrencyFile[] = vatCurrencyFromComposedCatalog()) {
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

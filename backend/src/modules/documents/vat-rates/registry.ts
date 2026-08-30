import { ALL_VAT_RATE_FILES } from './data/all';
import { CountryVatRatesFile, VatRateFact } from './schema';

function buildIndex(files: CountryVatRatesFile[]): Record<string, CountryVatRatesFile> {
  const index: Record<string, CountryVatRatesFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the VAT rate catalog files — the same role country-fields/registry.ts's
 * `CountryFieldOverlayCatalog` and country-policy/registry.ts's `CountryPolicyCatalog` play for
 * their own concerns. `descriptors/company-view.ts` is the only consumer: it reads `ratesFor`
 * (through `vatRateFieldOptions` below) to fill a 'select' field's `options` per company.
 */
export class VatRateCatalog {
  private readonly files: Record<string, CountryVatRatesFile>;

  constructor(files: CountryVatRatesFile[] = ALL_VAT_RATE_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a catalog file — sorted, for stable test/iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Every rate declared for a country, in file order. Empty for a country with no file at all — the
   *  same "no permissive fallback, no silent gap" shape `CountryPolicyCatalog.rulesFor` already
   *  holds, though here "gap" means "no known catalog", not "forbidden". */
  ratesFor(countryCode: string): VatRateFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.rates ?? [];
  }
}

export const defaultVatRateCatalog = new VatRateCatalog();

export interface VatRateFieldOption {
  value: string;
  label: string;
}

export interface VatRateOptionsResolution {
  /** The options a 'select' field should offer — empty when this country's catalog is unknown. */
  options: VatRateFieldOption[];
  /** Whether a catalog is known for this country AT ALL. `false` (not merely "options is empty")
   *  is what descriptors/company-view.ts uses to decide whether to show the "no known list" notice —
   *  a country could in principle have a catalog file that (temporarily) lists zero rates, which
   *  would still be "known", just empty; that is not a case this catalog needs to distinguish today
   *  (no shipped file does this), but the two concepts are kept separate rather than conflated. */
  known: boolean;
}

/**
 * Turns a country's VAT rate catalog into the `options` a 'select' field descriptor can offer — the
 * value is the rate's PERCENTAGE as a string (e.g. "20", "5.5"), because a 'select' field's stored
 * value is always a string (field-kinds.ts) and a document line only needs the NUMBER to eventually
 * compute with, never this catalog's `id`/`category`/provenance. The label carries the country's own
 * official term (e.g. "20% — Taux normal") — plain data, not run through i18n, the same convention
 * every other descriptor label already follows.
 *
 * Never throws for an unknown country: `known: false` with an empty list is the whole point of this
 * function existing — see descriptors/company-view.ts's own header on "no known catalog blocks
 * nobody".
 */
export function vatRateFieldOptions(catalog: VatRateCatalog, countryCode: string): VatRateOptionsResolution {
  const known = catalog.has(countryCode);
  const rates = catalog.ratesFor(countryCode);
  return {
    known,
    options: rates.map((rate) => ({
      value: String(rate.rate),
      label: `${rate.rate}% — ${rate.label}`,
    })),
  };
}

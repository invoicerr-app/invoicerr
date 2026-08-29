import { allByDate } from '../profiles/temporal';
import { ALL_VAT_RATE_FILES } from './data/all';
import type { CountryVatRatesFile, VatRateFact } from './schema';

function buildIndex(files: CountryVatRatesFile[]): Record<string, CountryVatRatesFile> {
  const index: Record<string, CountryVatRatesFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the VAT rate catalog files — the same role `ProfileRegistry` plays for country
 * compliance profiles, scaled down to one concern (rates). The seed reads `allWindows` (every
 * temporal entry, historical included, so the DB keeps the full history); the API reads `ratesAt`
 * (only what's in force on a given date).
 */
export class VatRateCatalog {
  private readonly files: Record<string, CountryVatRatesFile>;

  constructor(files: CountryVatRatesFile[] = ALL_VAT_RATE_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a catalog file — sorted, for stable test/seed iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Every temporal window ever declared for a country, in file order. */
  allWindows(countryCode: string): CountryVatRatesFile['rates'] {
    return this.files[(countryCode ?? '').toUpperCase()]?.rates ?? [];
  }

  /** Rates in force at `date` — what the API and the frontend picker actually see. */
  ratesAt(countryCode: string, date: Date): VatRateFact[] {
    return allByDate(this.allWindows(countryCode), date);
  }
}

export const defaultVatRateCatalog = new VatRateCatalog();

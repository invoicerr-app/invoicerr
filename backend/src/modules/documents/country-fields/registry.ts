import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from './data/all';
import { CountryFieldOverlayFile, FieldOverlayOperation } from './schema';

function buildIndex(files: CountryFieldOverlayFile[]): Record<string, CountryFieldOverlayFile> {
  const index: Record<string, CountryFieldOverlayFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the field overlay files — the same role CountryPolicyCatalog
 * (country-policy/registry.ts) plays for action rules and VatRateCatalog (vat-rates/registry.ts)
 * plays for rates. `descriptors/company-view.ts` reads `operationsFor` to know what to hand
 * apply-overlay.ts's `applyFieldOverlay` for a given (company's country, document type).
 */
export class CountryFieldOverlayCatalog {
  private readonly files: Record<string, CountryFieldOverlayFile>;

  constructor(files: CountryFieldOverlayFile[] = ALL_COUNTRY_FIELD_OVERLAY_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a field-overlay file — sorted, for stable test/iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /**
   * Every operation declared for (countryCode, typeId), in file order. Empty — NEVER thrown — both
   * for a country with no file at all, and for a country whose file exists but does not mention this
   * particular type: "no surcouche for this type" is the ordinary case (see country-fields/data/
   * all.ts's own header — even the one country with the most reason to have a file, France, ships
   * none today), not a misconfiguration.
   */
  operationsFor(countryCode: string, typeId: string): FieldOverlayOperation[] {
    const file = this.files[(countryCode ?? '').toUpperCase()];
    if (!file) return [];
    return file.overlays.find((overlay) => overlay.typeId === typeId)?.operations ?? [];
  }
}

export const defaultCountryFieldOverlayCatalog = new CountryFieldOverlayCatalog();

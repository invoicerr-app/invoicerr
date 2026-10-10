import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryFieldOverlayFile, FieldOverlayOperation } from './schema';
import { byCodeUnit } from '@/lib/compare';

function buildIndex(files: CountryFieldOverlayFile[]): Record<string, CountryFieldOverlayFile> {
  const index: Record<string, CountryFieldOverlayFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 3): every country's own `countryFields` section from
 * the composed per-country view, instead of this catalog's own `data/all.ts` directly. No import
 * cycle results, because `countries/compose.ts` reads the RAW loader
 * (`country-fields/data/all.ts`'s own `ALL_COUNTRY_FIELD_OVERLAY_FILES`), never this registry: see
 * that file's own header. The dependency direction is therefore one-way: this file depends on
 * `countries/registry.ts`, which depends on `countries/compose.ts`, which depends on
 * `country-fields/data/all.ts`; nothing depends back on this file from inside that chain. A country
 * with no `countryFields` section in the composed view is simply left out here, the same "no
 * permissive fallback" this catalog already held when it read `ALL_COUNTRY_FIELD_OVERLAY_FILES`
 * directly.
 */
function countryFieldOverlaysFromComposedCatalog(): CountryFieldOverlayFile[] {
  const files: CountryFieldOverlayFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const countryFields = defaultComposedCountryCatalog.get(countryCode)?.countryFields;
    if (countryFields) files.push(countryFields);
  }
  return files;
}

/**
 * In-memory view of the field overlay files — the same role CountryPolicyCatalog
 * (country-policy/registry.ts) plays for action rules and VatRateCatalog (vat-rates/registry.ts)
 * plays for rates. `descriptors/company-view.ts` reads `operationsFor` to know what to hand
 * apply-overlay.ts's `applyFieldOverlay` for a given (company's country, document type).
 *
 * The constructor still takes a plain `CountryFieldOverlayFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new CountryFieldOverlayCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where
 * it reads from.
 */
export class CountryFieldOverlayCatalog {
  private readonly files: Record<string, CountryFieldOverlayFile>;

  constructor(files: CountryFieldOverlayFile[] = countryFieldOverlaysFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a field-overlay file — sorted, for stable test/iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort(byCodeUnit);
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

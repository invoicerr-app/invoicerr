import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryDomesticReverseChargeFile, DomesticReverseChargeCategoryFact } from './schema';

function buildIndex(
  files: CountryDomesticReverseChargeFile[],
): Record<string, CountryDomesticReverseChargeFile> {
  const index: Record<string, CountryDomesticReverseChargeFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `domesticReverseCharge`
 * section from the composed per-country view, instead of this catalog's own `data/all.ts` directly.
 * No import cycle results, because `countries/compose.ts` reads the RAW loader
 * (`domestic-reverse-charge/data/all.ts`'s own `ALL_DOMESTIC_REVERSE_CHARGE_FILES`), never this
 * registry: see that file's own header. The dependency direction is therefore one-way: this file
 * depends on `countries/registry.ts`, which depends on `countries/compose.ts`, which depends on
 * `domestic-reverse-charge/data/all.ts`; nothing depends back on this file from inside that chain. A
 * country with no `domesticReverseCharge` section in the composed view is simply left out here, the
 * same "no permissive fallback" this catalog already held when it read
 * `ALL_DOMESTIC_REVERSE_CHARGE_FILES` directly.
 */
function domesticReverseChargeFromComposedCatalog(): CountryDomesticReverseChargeFile[] {
  const files: CountryDomesticReverseChargeFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const domesticReverseCharge = defaultComposedCountryCatalog.get(countryCode)?.domesticReverseCharge;
    if (domesticReverseCharge) files.push(domesticReverseCharge);
  }
  return files;
}

/**
 * In-memory view of the domestic reverse-charge catalog — the same role `mentions/registry.ts`'s own
 * `MentionsCatalog` plays for a different "a country is data" concern, and the same reason: this
 * catalog is small (four country files today) and cheap to re-read on every call, with no per-request
 * performance case that would justify mirroring it into a database the way `country-policy/`'s own
 * per-(country,type,action) rule table needs to be.
 *
 * Deliberately NOT registered as a Nest provider in `documents-core.module.ts` — same as
 * `defaultMentionsCatalog` below: nothing in this branch's tax engine, UI or `resolve-invoice-tax.ts`
 * reads this catalog yet (see `schema.ts`'s own header), so there is no DI consumer to wire it into.
 * A future caller either injects this class as a plain provider once one exists, or imports
 * `defaultCatalog` directly the way a pure function would — this repository's own precedent for a
 * catalog with no reader yet, not a decision unique to this one.
 *
 * The constructor still takes a plain `CountryDomesticReverseChargeFile[]` (never the composed
 * catalog itself), so an explicit, smaller list still works exactly as before for every existing
 * caller and test (e.g. `new DomesticReverseChargeCatalog([FR_FIXTURE])`): only the NO-ARGUMENT
 * default changed where it reads from.
 */
export class DomesticReverseChargeCatalog {
  private readonly files: Record<string, CountryDomesticReverseChargeFile>;

  constructor(files: CountryDomesticReverseChargeFile[] = domesticReverseChargeFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** The country's own categories, or an empty array for a country with none declared at all — never
   *  `undefined`: "nothing known" and "known to have zero categories" are the same observable state
   *  for this catalog (contrast `mentions/registry.ts#fileFor`, which returns `undefined` because it
   *  also needs to distinguish "no file" from "a file with an empty rule list" for `noteValues`; this
   *  catalog has no second piece of per-file data a caller could need instead). */
  categoriesFor(countryCode: string | undefined): DomesticReverseChargeCategoryFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.categories ?? [];
  }

  /** One category by its own `key`, scoped to a single country — `key` is unique only WITHIN a
   *  country's file (see `schema.ts`'s own header on why it is not a cross-country identity claim). */
  categoryFor(countryCode: string | undefined, key: string): DomesticReverseChargeCategoryFact | undefined {
    return this.categoriesFor(countryCode).find((c) => c.key === key);
  }
}

export const defaultDomesticReverseChargeCatalog = new DomesticReverseChargeCatalog();

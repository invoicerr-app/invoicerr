import { ALL_DOMESTIC_REVERSE_CHARGE_FILES } from './data/all';
import { CountryDomesticReverseChargeFile, DomesticReverseChargeCategoryFact } from './schema';

function buildIndex(
  files: CountryDomesticReverseChargeFile[],
): Record<string, CountryDomesticReverseChargeFile> {
  const index: Record<string, CountryDomesticReverseChargeFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
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
 */
export class DomesticReverseChargeCatalog {
  private readonly files: Record<string, CountryDomesticReverseChargeFile>;

  constructor(files: CountryDomesticReverseChargeFile[] = ALL_DOMESTIC_REVERSE_CHARGE_FILES) {
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

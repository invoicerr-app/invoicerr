import { defaultComposedCountryCatalog } from '../countries/registry';
import { ContentRequirementFact, CountryContentRequirementsFile } from './schema';

function buildIndex(files: CountryContentRequirementsFile[]): Record<string, CountryContentRequirementsFile> {
  const index: Record<string, CountryContentRequirementsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `contentRequirements` section
 * from the composed per-country view, instead of this catalog's own `data/all.ts` directly. No
 * import cycle results, because `countries/compose.ts` reads the RAW loader
 * (`content-requirements/data/all.ts`'s own `ALL_CONTENT_REQUIREMENT_FILES`), never this registry:
 * see that file's own header. The dependency direction is therefore one-way: this file depends on
 * `countries/registry.ts`, which depends on `countries/compose.ts`, which depends on
 * `content-requirements/data/all.ts`; nothing depends back on this file from inside that chain. A
 * country with no `contentRequirements` section in the composed view is simply left out here, the
 * same "no permissive fallback" this catalog already held when it read
 * `ALL_CONTENT_REQUIREMENT_FILES` directly.
 */
function contentRequirementsFromComposedCatalog(): CountryContentRequirementsFile[] {
  const files: CountryContentRequirementsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const contentRequirements = defaultComposedCountryCatalog.get(countryCode)?.contentRequirements;
    if (contentRequirements) files.push(contentRequirements);
  }
  return files;
}

/**
 * In-memory view of the content-requirement files — the same role `ChannelPolicyCatalog`
 * (`../transports/channel-policy/registry.ts`) plays for its own country-is-data concern, and the
 * same reason it is never mirrored into a database: a requirement's binding effect costs nothing to
 * re-read straight from these files on every build, and there is no per-request performance case
 * here that would justify a `country-policy/`-style table.
 *
 * The constructor still takes a plain `CountryContentRequirementsFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new ContentRequirementCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where
 * it reads from.
 */
export class ContentRequirementCatalog {
  private readonly files: Record<string, CountryContentRequirementsFile>;

  constructor(files: CountryContentRequirementsFile[] = contentRequirementsFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  /** Every fact declared for a country, in file order. Empty — never thrown — for a country with no
   *  file at all: the same "no permissive fallback, no silent guess" discipline every sibling
   *  catalog in `documents/` already holds. */
  factsFor(countryCode: string): ContentRequirementFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.facts ?? [];
  }
}

export const defaultContentRequirementCatalog = new ContentRequirementCatalog();

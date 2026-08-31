import { ALL_CONTENT_REQUIREMENT_FILES } from './data/all';
import { ContentRequirementFact, CountryContentRequirementsFile } from './schema';

function buildIndex(files: CountryContentRequirementsFile[]): Record<string, CountryContentRequirementsFile> {
  const index: Record<string, CountryContentRequirementsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the content-requirement files — the same role `ChannelPolicyCatalog`
 * (`../transports/channel-policy/registry.ts`) plays for its own country-is-data concern, and the
 * same reason it is never mirrored into a database: a requirement's binding effect costs nothing to
 * re-read straight from these files on every build, and there is no per-request performance case
 * here that would justify a `country-policy/`-style table.
 */
export class ContentRequirementCatalog {
  private readonly files: Record<string, CountryContentRequirementsFile>;

  constructor(files: CountryContentRequirementsFile[] = ALL_CONTENT_REQUIREMENT_FILES) {
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

import { ALL_RETENTION_FILES } from './data/all';
import { CountryRetentionFile } from './schema';

function buildIndex(files: CountryRetentionFile[]): Record<string, CountryRetentionFile> {
  const index: Record<string, CountryRetentionFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the retention-duration files — the same role `mentions/registry.ts#MentionsCatalog`
 * plays for its own country-is-data concern, and the same reason: a retention rule costs nothing to
 * re-read straight from these files on every archive write, and there is no per-request performance
 * case that would justify mirroring it into a database.
 *
 * Read by `archive-on-send.ts` (resolving the ISSUING company's own country's rules at the moment an
 * archive is written) — never by anything that writes to Prisma directly.
 */
export class RetentionCatalog {
  private readonly files: Record<string, CountryRetentionFile>;

  constructor(files: CountryRetentionFile[] = ALL_RETENTION_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** The country's own retention file, or `undefined` for a country with none at all — the same "no
   *  permissive fallback, no silent guess" discipline `MentionsCatalog.fileFor` holds. */
  fileFor(countryCode: string | undefined): CountryRetentionFile | undefined {
    return this.files[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultRetentionCatalog = new RetentionCatalog();

import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryRetentionFile } from './schema';

function buildIndex(files: CountryRetentionFile[]): Record<string, CountryRetentionFile> {
  const index: Record<string, CountryRetentionFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `retention` section from the
 * composed per-country view, instead of this catalog's own `data/all.ts` directly. No import cycle
 * results, because `countries/compose.ts` reads the RAW loader (`archive/retention/data/all.ts`'s own
 * `ALL_RETENTION_FILES`), never this registry: see that file's own header. The dependency direction
 * is therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `archive/retention/data/all.ts`; nothing depends back on
 * this file from inside that chain. A country with no `retention` section in the composed view is
 * simply left out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_RETENTION_FILES` directly.
 */
function retentionFromComposedCatalog(): CountryRetentionFile[] {
  const files: CountryRetentionFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const retention = defaultComposedCountryCatalog.get(countryCode)?.retention;
    if (retention) files.push(retention);
  }
  return files;
}

/**
 * In-memory view of the retention-duration files — the same role `mentions/registry.ts#MentionsCatalog`
 * plays for its own country-is-data concern, and the same reason: a retention rule costs nothing to
 * re-read straight from these files on every archive write, and there is no per-request performance
 * case that would justify mirroring it into a database.
 *
 * Read by `archive-on-send.ts` (resolving the ISSUING company's own country's rules at the moment an
 * archive is written) — never by anything that writes to Prisma directly.
 *
 * The constructor still takes a plain `CountryRetentionFile[]` (never the composed catalog itself),
 * so an explicit, smaller list still works exactly as before for every existing caller and test (e.g.
 * `new RetentionCatalog([FR])`): only the NO-ARGUMENT default changed where it reads from.
 */
export class RetentionCatalog {
  private readonly files: Record<string, CountryRetentionFile>;

  constructor(files: CountryRetentionFile[] = retentionFromComposedCatalog()) {
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

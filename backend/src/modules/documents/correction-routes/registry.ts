import { ALL_CORRECTION_ROUTES_FILES } from './data/all';
import { CountryCorrectionRoutesFile } from './schema';

function buildIndex(files: CountryCorrectionRoutesFile[]): Record<string, CountryCorrectionRoutesFile> {
  const index: Record<string, CountryCorrectionRoutesFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the correction-routes files — the same role `mentions/registry.ts#MentionsCatalog`
 * plays for its own country-is-data concern, and for the SAME reason (see that class's own header):
 * a correction route's binding effect (required/allowed/forbidden) costs nothing to re-read straight
 * from these files on every request, and this is a NEW, still-narrow mechanism (TODO_CORRECTION.md C1)
 * with no existing per-request performance case that would justify mirroring it into a database the
 * way `country-policy/` and `b2g-routing/` (both older, both proven under real load) already are.
 *
 * DELIBERATE CHOICE — file read, never a DB table (see this module's own README-equivalent, this
 * comment): `country-policy/` and `b2g-routing/` both boot-upsert their files into Postgres so every
 * API/worker replica sees the SAME rule the instant ANY of them boots with a newer data file (see
 * `b2g-routing/b2g-routing.ts`'s own header for the exact reasoning). That reasoning does not yet
 * apply here: this format has no write-time consumer that would benefit from a queryable table (no
 * `boot-upsert.service.ts` equivalent needed), and `mentions/` already proves this exact shape works
 * fine for a country-is-data catalog of comparable size read on every document build. Should a future
 * task need to inspect/audit these rules as rows (an admin screen, a cross-country report), promoting
 * this to a seeded table is the same mechanical move `country-policy/` already demonstrates — nothing
 * about this class's own shape would need to change to get there.
 *
 * Read by `correction-routes.ts`'s own `resolveCorrectionRoutesForCountry` — never by anything that
 * writes to Prisma.
 */
export class CorrectionRoutesCatalog {
  private readonly files: Record<string, CountryCorrectionRoutesFile>;

  constructor(files: CountryCorrectionRoutesFile[] = ALL_CORRECTION_ROUTES_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** The country's own correction-routes file, or `undefined` for a country with none at all — the
   *  same "no permissive fallback, no silent guess" discipline `MentionsCatalog.fileFor` and
   *  `resolveB2gRoutingRule` both already hold. */
  fileFor(countryCode: string | undefined | null): CountryCorrectionRoutesFile | undefined {
    return this.files[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultCorrectionRoutesCatalog = new CorrectionRoutesCatalog();

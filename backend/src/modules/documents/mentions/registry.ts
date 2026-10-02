import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryMentionsFile } from './schema';

function buildIndex(files: CountryMentionsFile[]): Record<string, CountryMentionsFile> {
  const index: Record<string, CountryMentionsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `mentions` section from the
 * composed per-country view, instead of this catalog's own `data/all.ts` directly. No import cycle
 * results, because `countries/compose.ts` reads the RAW loader (`mentions/data/all.ts`'s own
 * `ALL_MENTIONS_FILES`), never this registry: see that file's own header. The dependency direction is
 * therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `mentions/data/all.ts`; nothing depends back on this file
 * from inside that chain. A country with no `mentions` section in the composed view is simply left
 * out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_MENTIONS_FILES` directly.
 */
function mentionsFromComposedCatalog(): CountryMentionsFile[] {
  const files: CountryMentionsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const mentions = defaultComposedCountryCatalog.get(countryCode)?.mentions;
    if (mentions) files.push(mentions);
  }
  return files;
}

/**
 * In-memory view of the mandatory-mentions files — the same role
 * `transports/channel-policy/registry.ts#ChannelPolicyCatalog` plays for its own country-is-data
 * concern, and the same reason: a mention's binding effect (what BG-1 must contain) costs nothing to
 * re-read straight from these files on every build/render, and there is no per-request performance
 * case here that would justify mirroring it into a database the way `country-policy/`'s own
 * per-(country,type,action) rule table needs to be (see that module's header for the contrast).
 *
 * Read by `formats/semantic/build-semantic-invoice.ts` (BG-1 in the CII/UBL export) and
 * `rendering/render-instance-pdf.ts` (the printed legal-mentions block) — never by anything that
 * writes to Prisma.
 *
 * The constructor still takes a plain `CountryMentionsFile[]` (never the composed catalog itself),
 * so an explicit, smaller list still works exactly as before for every existing caller and test (e.g.
 * `new MentionsCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where it reads from.
 */
export class MentionsCatalog {
  private readonly files: Record<string, CountryMentionsFile>;

  constructor(files: CountryMentionsFile[] = mentionsFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** The country's own mentions file, or `undefined` for a country with none at all — the same "no
   *  permissive fallback, no silent guess" discipline `ChannelPolicyCatalog.factsFor` holds, scaled
   *  to "return the whole file" rather than "return a list" because `invoice-notes.ts`'s own
   *  `resolveInvoiceNotes` needs both `invoiceNotes` AND `noteValues` together to interpolate a
   *  placeholder correctly. */
  fileFor(countryCode: string | undefined): CountryMentionsFile | undefined {
    return this.files[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultMentionsCatalog = new MentionsCatalog();

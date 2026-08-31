import { ALL_MENTIONS_FILES } from './data/all';
import { CountryMentionsFile } from './schema';

function buildIndex(files: CountryMentionsFile[]): Record<string, CountryMentionsFile> {
  const index: Record<string, CountryMentionsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
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
 */
export class MentionsCatalog {
  private readonly files: Record<string, CountryMentionsFile>;

  constructor(files: CountryMentionsFile[] = ALL_MENTIONS_FILES) {
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

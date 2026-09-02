import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { CountryReportingObligationFile, ReportableDocumentType, ReportingObligationFact } from './schema';

function buildIndex(files: CountryReportingObligationFile[]): Record<string, CountryReportingObligationFile> {
  const index: Record<string, CountryReportingObligationFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the reporting-obligation files — read directly, at "sent" time, by
 * `report-on-send.ts`. Same "no database mirror" choice as `transports/channel-policy/registry.ts`'s
 * own `ChannelPolicyCatalog` (see that file's own header for the full reasoning this one shares
 * verbatim): a country's obligation costs nothing to re-read straight from these two small files on
 * every send, there is no per-request performance case that would justify a `resetAndSeed`-style
 * database mirror (`country-policy/`'s own tradeoff, made for an entirely different reason: a
 * per-(country, type, action) rule table queried far more densely than "does this ONE country have a
 * reporting fact").
 */
export class ReportingObligationCatalog {
  private readonly files: Record<string, CountryReportingObligationFile>;

  constructor(files: CountryReportingObligationFile[] = ALL_REPORTING_OBLIGATION_FILES) {
    this.files = buildIndex(files);
  }

  /** Every fact declared for a country, in file order. Empty for a country with no file at all — the
   *  same "no permissive fallback, no silent guess" discipline every sibling catalog in this module
   *  already holds. */
  factsFor(countryCode: string): ReportingObligationFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.facts ?? [];
  }

  /**
   * The ONE fact (if any) that binds a document of type `typeId`, issued by a seller in
   * `countryCode`, to a declarative provider — what `report-on-send.ts` actually calls. A country
   * could in principle declare more than one provider for the same type (never shipped today); this
   * returns the FIRST match, in file order, the same "first match wins, never merged" convention
   * `channel-policy/mandate.ts`'s own `activeChannelMandateFor` already holds for its own lookup.
   */
  obligationFor(
    countryCode: string | undefined,
    typeId: ReportableDocumentType | string,
  ): ReportingObligationFact | undefined {
    if (!countryCode) return undefined;
    return this.factsFor(countryCode).find((fact) => fact.appliesTo === typeId);
  }
}

export const defaultReportingObligationCatalog = new ReportingObligationCatalog();

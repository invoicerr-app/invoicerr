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
   * The ONE fact (if any) `report-on-send.ts` should auto-enqueue a report job for — a NARROWER
   * question than "does this country have ANY fact for this type" (`factsFor` answers that,
   * unfiltered, for the settings screen). Two kinds of fact live in `reporting/data/*.json` but are
   * DELIBERATELY excluded here, never silently auto-triggered:
   *
   *   - `dischargedBy: 'transport'` (France's B2B-domestic invoices, discharged by the PDP as a
   *     side effect of delivery): there is nothing for THIS mechanism to enqueue — the transport
   *     already carries the data. Enqueuing a report job under the transport's own id would also
   *     wrongly conflate it with a genuine declaration provider — see `schema.ts`'s own
   *     `providerId` doc for why that distinction matters to `list-declarations.ts`.
   *   - a fact carrying a `scope` restriction (France's B2C/export/intra-EU/payments facts, CGI
   *     art. 290/290 A): this codebase has no per-invoice classifier for "is this buyer domestic or
   *     foreign, B2B or B2C" at send time — firing on EVERY invoice would over-report (a
   *     B2B-domestic invoice is already covered by the transport row above), so until that
   *     classifier exists this returns nothing rather than guess, the same "read by nothing yet,
   *     deliberately" posture `domestic-reverse-charge/DESIGN.md` documents for its own catalog.
   *
   * Only an UNSCOPED, `dischargedBy: 'provider'` fact (Portugal today) is safe to fire
   * unconditionally on every document of `appliesTo`'s type — the shape this catalog held before
   * `scope`/`dischargedBy` existed at all. A country could in principle declare more than one such
   * fact for the same type (never shipped today); this returns the FIRST match, in file order, the
   * same "first match wins, never merged" convention `channel-policy/mandate.ts`'s own
   * `activeChannelMandateFor` already holds for its own lookup.
   */
  obligationFor(
    countryCode: string | undefined,
    typeId: ReportableDocumentType | string,
  ): ReportingObligationFact | undefined {
    if (!countryCode) return undefined;
    return this.factsFor(countryCode).find(
      (fact) => fact.appliesTo === typeId && fact.dischargedBy === 'provider' && !fact.scope,
    );
  }
}

export const defaultReportingObligationCatalog = new ReportingObligationCatalog();

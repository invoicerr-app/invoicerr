import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryReportingObligationFile, ReportableDocumentType, ReportingObligationFact } from './schema';

function buildIndex(files: CountryReportingObligationFile[]): Record<string, CountryReportingObligationFile> {
  const index: Record<string, CountryReportingObligationFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `reporting` section from the
 * composed per-country view, instead of this catalog's own `data/all.ts` directly. No import cycle
 * results, because `countries/compose.ts` reads the RAW loader (`reporting/data/all.ts`'s own
 * `ALL_REPORTING_OBLIGATION_FILES`), never this registry: see that file's own header. The dependency
 * direction is therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `reporting/data/all.ts`; nothing depends back on this
 * file from inside that chain. A country with no `reporting` section in the composed view is simply
 * left out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_REPORTING_OBLIGATION_FILES` directly.
 */
export function reportingObligationsFromComposedCatalog(): CountryReportingObligationFile[] {
  const files: CountryReportingObligationFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const reporting = defaultComposedCountryCatalog.get(countryCode)?.reporting;
    if (reporting) files.push(reporting);
  }
  return files;
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
 *
 * The constructor still takes a plain `CountryReportingObligationFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new ReportingObligationCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where
 * it reads from.
 */
export class ReportingObligationCatalog {
  private readonly files: Record<string, CountryReportingObligationFile>;

  constructor(files: CountryReportingObligationFile[] = reportingObligationsFromComposedCatalog()) {
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
   *   - a fact carrying a `scope` restriction (France's B2C and payments facts, CGI art. 290/290 A):
   *     it is matched per operation by `classify.ts` through `providerFactsFor`, so this method
   *     (the narrower "one fact I may fire blind with" question) returns nothing for it rather than
   *     guess.
   *
   * Only an UNSCOPED, `dischargedBy: 'provider'` fact (Portugal today) is safe to fire
   * unconditionally on every document of `appliesTo`'s type — the shape this catalog held before
   * `scope`/`dischargedBy` existed at all. A country could in principle declare more than one such
   * fact for the same type (never shipped today); this returns the FIRST match, in file order, the
   * same "first match wins, never merged" convention `channel-policy/mandate.ts`'s own
   * `activeChannelMandateFor` already holds for its own lookup.
   */
  /**
   * Every fact of `appliesTo`'s type this mechanism could DECLARE (provider-discharged, scoped or
   * not), in file order. `report-on-send.ts` and `report-payment.ts` run each through
   * `classify.ts` and enqueue the first one that covers the operation; an unscoped fact (Portugal)
   * still classifies as `in` for every document, so its behaviour is unchanged.
   *
   * `obligationFor` below keeps its narrower pre-classifier contract: the answer to "is there one
   * fact I may fire blind with", which is what the settings screen and the historical tests read.
   */
  /**
   * Every fact carrying `providerId` for this document type, across every country file  -  what the
   * report job uses to re-classify at run time without re-resolving the seller country (the job was
   * enqueued under a fact that already named this provider, and an id shared by two countries would
   * otherwise need the country again). Order follows the catalog's own file index.
   */
  factsForProvider(providerId: string, typeId: ReportableDocumentType | string): ReportingObligationFact[] {
    const facts: ReportingObligationFact[] = [];
    for (const file of Object.values(this.files)) {
      for (const fact of file.facts) {
        if (fact.providerId === providerId && fact.appliesTo === typeId) facts.push(fact);
      }
    }
    return facts;
  }

  providerFactsFor(
    countryCode: string | undefined,
    typeId: ReportableDocumentType | string,
  ): ReportingObligationFact[] {
    if (!countryCode) return [];
    return this.factsFor(countryCode).filter(
      (fact) => fact.appliesTo === typeId && fact.dischargedBy === 'provider',
    );
  }

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

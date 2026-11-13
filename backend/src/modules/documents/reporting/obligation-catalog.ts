import {
  assertValidReportingObligationFileV2,
  ChannelDischarger,
  CountryReportingObligationFileV2,
  InvalidReportingObligationError,
  ReportingObligation,
  upgradeLegacyFacts,
} from './obligation-v2';
import { reportingObligationsFromComposedCatalog } from './registry';
import { CountryReportingObligationFile, ReportableDocumentType } from './schema';

/** A country's `reporting` section as the catalog accepts it: still legacy facts, or already v2. */
export type ReportingObligationSource = CountryReportingObligationFile | CountryReportingObligationFileV2;

function isV2(file: ReportingObligationSource): file is CountryReportingObligationFileV2 {
  return Array.isArray((file as CountryReportingObligationFileV2).obligations);
}

function toV2(file: ReportingObligationSource): CountryReportingObligationFileV2 {
  if (!isV2(file)) return upgradeLegacyFacts(file);
  assertValidReportingObligationFileV2(
    file,
    `countries/data/${(file.countryCode ?? '').toLowerCase()}.json#reporting`,
  );
  return file;
}

function hasChannel(obligation: ReportingObligation, dischargedBy: ChannelDischarger, id?: string): boolean {
  return obligation.channels.some(
    (channel) => channel.dischargedBy === dischargedBy && (id === undefined || channel.id === id),
  );
}

function covers(obligation: ReportingObligation, typeId: ReportableDocumentType | string): boolean {
  return (obligation.scope.documentTypes as string[]).includes(typeId);
}

/**
 * Read API over the v2 obligation format (issue #767). Every country file is upgraded or validated
 * once, when the catalog is built, so a malformed file fails at load with a named error rather than
 * at the first send. Nothing reads this catalog yet: the consumers still read the legacy
 * `ReportingObligationCatalog` in `registry.ts`, and each query below answers the same question as
 * its legacy counterpart, which `obligation-catalog.spec.ts` pins against the shipped files.
 *
 * Same "no database mirror" choice as the legacy catalog: the files are small and read in memory.
 * Lookups never fall back: a country with no file, or an absent country code, has no obligation.
 */
export class ReportingObligationCatalogV2 {
  private readonly files: Record<string, CountryReportingObligationFileV2> = {};

  constructor(sources: ReportingObligationSource[] = reportingObligationsFromComposedCatalog()) {
    for (const source of sources) {
      const file = toV2(source);
      if (this.files[file.countryCode]) {
        throw new InvalidReportingObligationError(
          `reporting catalog: country "${file.countryCode}" has more than one reporting section.`,
        );
      }
      this.files[file.countryCode] = file;
    }
  }

  /** The countries that have a reporting section, in load order. */
  countries(): string[] {
    return Object.keys(this.files);
  }

  /** Every obligation of a country, in file order. Legacy counterpart: `factsFor`. */
  obligationsFor(countryCode: string | undefined): ReportingObligation[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.obligations ?? [];
  }

  /** One obligation by its id, unique within its country file. */
  obligation(countryCode: string | undefined, obligationId: string): ReportingObligation | undefined {
    return this.obligationsFor(countryCode).find((obligation) => obligation.id === obligationId);
  }

  /**
   * Every obligation of a country covering this document type that the app declares itself through a
   * provider channel, scoped or not, in file order. The caller classifies each against the operation.
   * Legacy counterpart: `providerFactsFor`.
   */
  providerObligationsFor(
    countryCode: string | undefined,
    typeId: ReportableDocumentType | string,
  ): ReportingObligation[] {
    return this.obligationsFor(countryCode).filter(
      (obligation) => covers(obligation, typeId) && hasChannel(obligation, 'provider'),
    );
  }

  /**
   * Every obligation, across every country, that a given provider discharges for this document type:
   * what a report job re-reads at run time from the provider id it was enqueued under.
   * Legacy counterpart: `factsForProvider`.
   */
  obligationsForProvider(providerId: string, typeId: ReportableDocumentType | string): ReportingObligation[] {
    return Object.values(this.files).flatMap((file) =>
      file.obligations.filter(
        (obligation) => covers(obligation, typeId) && hasChannel(obligation, 'provider', providerId),
      ),
    );
  }

  /**
   * The first obligation that may be declared for every document of this type without classifying
   * the operation: a provider channel and no transaction scope. Transport-discharged obligations are
   * left out, since the delivery channel already carries the data. Legacy counterpart: `obligationFor`.
   */
  unscopedProviderObligationFor(
    countryCode: string | undefined,
    typeId: ReportableDocumentType | string,
  ): ReportingObligation | undefined {
    return this.providerObligationsFor(countryCode, typeId).find(
      (obligation) => !obligation.scope.transactions,
    );
  }

  /** The id of the provider channel of an obligation, the id a report job is enqueued under. */
  static providerChannelId(obligation: ReportingObligation): string | undefined {
    return obligation.channels.find((channel) => channel.dischargedBy === 'provider')?.id;
  }
}

export const defaultReportingObligationCatalogV2 = new ReportingObligationCatalogV2();

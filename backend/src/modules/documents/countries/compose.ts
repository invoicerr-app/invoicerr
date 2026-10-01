/**
 * The composed per-country view (issue #603, step 1 of the "one JSON per country" migration: see
 * `AUDIT_DONNEES_PAYS.md` and `documentation/docs/developer-guide/adding-a-country.md`'s own
 * "Composed per-country view" section). One object per supported country, carrying one optional
 * section per existing catalog this module already has a file-per-country loader for.
 *
 * This reads NOTHING new and moves NOTHING. Every section below is exactly what that catalog's own
 * `data/all.ts` already validated and returned (`ALL_COUNTRY_POLICY_FILES`,
 * `ALL_COUNTRY_IDENTIFIER_FILES`, …). This file only groups those 14 already-loaded, already-
 * validated arrays by `countryCode` into one. No catalog's own `registry.ts` reads this yet, and no
 * existing behaviour changes: see this directory's own `README` pointer in the developer guide for
 * why that matters and what step comes next.
 *
 * A section is `undefined` for a country whose catalog has no `data/<cc>.json` at all, never a
 * guessed or defaulted value: the same "no permissive fallback" discipline every one of these 14
 * catalogs already holds on its own (see e.g. `country-policy/country-policy.ts`'s own header).
 * `has()`/`countries()`/`get()` convenience lives in `registry.ts` next to this file, not here.
 * This module stays the pure composition step, the same split every sibling catalog already keeps
 * between its own `data/all.ts` (loading) and `registry.ts` (reading).
 */
import { ALL_COUNTRY_POLICY_FILES } from '../country-policy/data/all';
import { CountryDocumentPolicyFile } from '../country-policy/schema';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '../country-identifiers/data/all';
import { CountryIdentifierRequirementsFile } from '../country-identifiers/schema';
import { ALL_CORRECTION_ROUTES_FILES } from '../correction-routes/data/all';
import { CountryCorrectionRoutesFile } from '../correction-routes/schema';
import { ALL_VAT_RATE_FILES } from '../vat-rates/data/all';
import { CountryVatRatesFile } from '../vat-rates/schema';
import { ALL_TAX_SYSTEM_FILES } from '../tax/tax-systems/data/all';
import { CountryTaxSystemFact } from '../tax/tax-systems/schema';
import { ALL_VAT_CURRENCY_FILES } from '../vat-currency/data/all';
import { CountryVatCurrencyFile } from '../vat-currency/schema';
import { ALL_CHANNEL_POLICY_FILES } from '../transports/channel-policy/data/all';
import { CountryChannelPolicyFile } from '../transports/channel-policy/schema';
import { ALL_RETENTION_FILES } from '../archive/retention/data/all';
import { CountryRetentionFile } from '../archive/retention/schema';
import { ALL_MENTIONS_FILES } from '../mentions/data/all';
import { CountryMentionsFile } from '../mentions/schema';
import { ALL_REPORTING_OBLIGATION_FILES } from '../reporting/data/all';
import { CountryReportingObligationFile } from '../reporting/schema';
import { ALL_DOMESTIC_REVERSE_CHARGE_FILES } from '../domestic-reverse-charge/data/all';
import { CountryDomesticReverseChargeFile } from '../domestic-reverse-charge/schema';
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from '../country-fields/data/all';
import { CountryFieldOverlayFile } from '../country-fields/schema';
import { ALL_CONTENT_REQUIREMENT_FILES } from '../content-requirements/data/all';
import { CountryContentRequirementsFile } from '../content-requirements/schema';
import { ALL_B2G_ROUTING_FILES } from '../b2g-routing/data/all';
import { B2gRoutingRuleFact } from '../b2g-routing/schema';

/** One composed view per country, one optional field per existing catalog: see this module's own
 *  header. A field is present if and only if that catalog's own `data/<cc>.json` exists for this
 *  country; nothing here invents or defaults a section the source catalog does not itself carry. */
export interface ComposedCountryView {
  countryCode: string;
  policy?: CountryDocumentPolicyFile;
  identifiers?: CountryIdentifierRequirementsFile;
  correctionRoutes?: CountryCorrectionRoutesFile;
  vatRates?: CountryVatRatesFile;
  taxSystem?: CountryTaxSystemFact;
  vatCurrency?: CountryVatCurrencyFile;
  channelPolicy?: CountryChannelPolicyFile;
  retention?: CountryRetentionFile;
  mentions?: CountryMentionsFile;
  reporting?: CountryReportingObligationFile;
  domesticReverseCharge?: CountryDomesticReverseChargeFile;
  countryFields?: CountryFieldOverlayFile;
  contentRequirements?: CountryContentRequirementsFile;
  b2gRouting?: B2gRoutingRuleFact;
}

/** Every section key `ComposedCountryView` declares besides `countryCode` itself, in the same order
 *  as the interface above, exported so a test (or a future consumer) can enumerate them generically
 *  instead of hand-copying this list a second time. */
export const COMPOSED_COUNTRY_SECTION_KEYS: ReadonlyArray<keyof Omit<ComposedCountryView, 'countryCode'>> = [
  'policy',
  'identifiers',
  'correctionRoutes',
  'vatRates',
  'taxSystem',
  'vatCurrency',
  'channelPolicy',
  'retention',
  'mentions',
  'reporting',
  'domesticReverseCharge',
  'countryFields',
  'contentRequirements',
  'b2gRouting',
];

function indexByCountryCode<T extends { countryCode: string }>(files: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const file of files) index.set(file.countryCode, file);
  return index;
}

const policyIndex = indexByCountryCode(ALL_COUNTRY_POLICY_FILES);
const identifiersIndex = indexByCountryCode(ALL_COUNTRY_IDENTIFIER_FILES);
const correctionRoutesIndex = indexByCountryCode(ALL_CORRECTION_ROUTES_FILES);
const vatRatesIndex = indexByCountryCode(ALL_VAT_RATE_FILES);
const taxSystemIndex = indexByCountryCode(ALL_TAX_SYSTEM_FILES);
const vatCurrencyIndex = indexByCountryCode(ALL_VAT_CURRENCY_FILES);
const channelPolicyIndex = indexByCountryCode(ALL_CHANNEL_POLICY_FILES);
const retentionIndex = indexByCountryCode(ALL_RETENTION_FILES);
const mentionsIndex = indexByCountryCode(ALL_MENTIONS_FILES);
const reportingIndex = indexByCountryCode(ALL_REPORTING_OBLIGATION_FILES);
const domesticReverseChargeIndex = indexByCountryCode(ALL_DOMESTIC_REVERSE_CHARGE_FILES);
const countryFieldsIndex = indexByCountryCode(ALL_COUNTRY_FIELD_OVERLAY_FILES);
const contentRequirementsIndex = indexByCountryCode(ALL_CONTENT_REQUIREMENT_FILES);
const b2gRoutingIndex = indexByCountryCode(ALL_B2G_ROUTING_FILES);

/** Every section's own index, in the SAME order as `COMPOSED_COUNTRY_SECTION_KEYS`, kept as a
 *  parallel array (rather than a single keyed structure) so `discoverComposedCountryCodes` and
 *  `composeCountry` below can walk it generically, with no section's name written as a decision
 *  literal anywhere in this file. */
const ALL_SECTION_INDEXES: ReadonlyArray<Map<string, { countryCode: string }>> = [
  policyIndex,
  identifiersIndex,
  correctionRoutesIndex,
  vatRatesIndex,
  taxSystemIndex,
  vatCurrencyIndex,
  channelPolicyIndex,
  retentionIndex,
  mentionsIndex,
  reportingIndex,
  domesticReverseChargeIndex,
  countryFieldsIndex,
  contentRequirementsIndex,
  b2gRoutingIndex,
];

/** Every country code ANY of the 14 catalogs above has a file for, sorted for a deterministic order,
 *  the same discovery discipline every one of those catalogs' own `data/all.ts` already applies to
 *  its own directory, one level up. A country present in only one catalog still gets a composed view
 *  here, with every other section left `undefined`. */
function discoverComposedCountryCodes(): string[] {
  const codes = new Set<string>();
  for (const index of ALL_SECTION_INDEXES) {
    for (const code of index.keys()) codes.add(code);
  }
  return Array.from(codes).sort();
}

function composeCountry(countryCode: string): ComposedCountryView {
  return {
    countryCode,
    policy: policyIndex.get(countryCode),
    identifiers: identifiersIndex.get(countryCode),
    correctionRoutes: correctionRoutesIndex.get(countryCode),
    vatRates: vatRatesIndex.get(countryCode),
    taxSystem: taxSystemIndex.get(countryCode),
    vatCurrency: vatCurrencyIndex.get(countryCode),
    channelPolicy: channelPolicyIndex.get(countryCode),
    retention: retentionIndex.get(countryCode),
    mentions: mentionsIndex.get(countryCode),
    reporting: reportingIndex.get(countryCode),
    domesticReverseCharge: domesticReverseChargeIndex.get(countryCode),
    countryFields: countryFieldsIndex.get(countryCode),
    contentRequirements: contentRequirementsIndex.get(countryCode),
    b2gRouting: b2gRoutingIndex.get(countryCode),
  };
}

/** One composed view per country that has at least one of the 14 catalogs' files: see this module's
 *  own header. Every one of the 14 arrays imported above is READ-ONLY input, already loaded and
 *  already validated by its own catalog's `data/all.ts`: nothing here re-implements a loader or a
 *  provenance check, and nothing here is read by any existing catalog's own `registry.ts` yet. */
export const ALL_COMPOSED_COUNTRIES: ComposedCountryView[] =
  discoverComposedCountryCodes().map(composeCountry);

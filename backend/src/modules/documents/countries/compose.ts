/**
 * The composed per-country view (issue #603: see `AUDIT_DONNEES_PAYS.md` and
 * `documentation/docs/developer-guide/adding-a-country.md`'s own "Composed per-country view"
 * section). One object per supported country, carrying one optional section per mechanism this
 * module covers.
 *
 * Step 6 physically moved the data: every section below now comes from ONE file per country,
 * `countries/data/<cc>.json`, loaded and validated by `./data/all.ts` (`ALL_COMPOSED_COUNTRY_FILES`)
 * - the single place any of these 14 sections is read off disk, replacing the 14 independent
 * per-catalog loaders this file used to import directly (steps 1-5, see git history for that
 * shape). Every one of the 14 catalogs' own `registry.ts` already reads THIS file's own
 * `ALL_COMPOSED_COUNTRIES` (through `./registry.ts`'s `defaultComposedCountryCatalog`), so moving
 * where the data physically lives changed nothing downstream of here.
 *
 * A section is `undefined` for a country whose file has no such key at all, never a guessed or
 * defaulted value: the same "no permissive fallback" discipline every one of these 14 catalogs
 * already holds on its own (see e.g. `country-policy/country-policy.ts`'s own header).
 * `has()`/`countries()`/`get()` convenience lives in `registry.ts` next to this file, not here.
 */
import { ALL_COMPOSED_COUNTRY_FILES } from './data/all';
import { CountryDocumentPolicyFile } from '../country-policy/schema';
import { CountryIdentifierRequirementsFile } from '../country-identifiers/schema';
import { CountryCorrectionRoutesFile } from '../correction-routes/schema';
import { CountryVatRatesFile } from '../vat-rates/schema';
import { CountryTaxSystemFact } from '../tax/tax-systems/schema';
import { CountryVatCurrencyFile } from '../vat-currency/schema';
import { CountryChannelPolicyFile } from '../transports/channel-policy/schema';
import { CountryRetentionFile } from '../archive/retention/schema';
import { CountryMentionsFile } from '../mentions/schema';
import { CountryReportingObligationFile } from '../reporting/schema';
import { CountryDomesticReverseChargeFile } from '../domestic-reverse-charge/schema';
import { CountryFieldOverlayFile } from '../country-fields/schema';
import { CountryContentRequirementsFile } from '../content-requirements/schema';
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

/** One composed view per country with a `countries/data/<cc>.json` file: see this module's own
 * header. `./data/all.ts` is now the only place that reads or validates any of these 14 sections -
 *  this is a direct pass-through of its output, sorted by `countryCode` the same way that loader's
 *  own `discoverCountryCodes()` already sorts its file discovery. */
export const ALL_COMPOSED_COUNTRIES: ComposedCountryView[] = [...ALL_COMPOSED_COUNTRY_FILES].sort((a, b) =>
  a.countryCode.localeCompare(b.countryCode),
);

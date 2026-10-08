/**
 * The single composed loader (issue #603 step 6: "one JSON file per country"). Every country now has
 * exactly ONE file here, `countries/data/<cc>.json`, with one optional top-level key per section -
 * the same keys `ComposedCountryView` (`../compose.ts`) already declares, in the same order
 * `COMPOSED_COUNTRY_SECTION_KEYS` does. This is the only place any of the 14 sections is read off
 * disk any more: discovery is a single `readdirSync` over this directory (the same
 * `/^[a-z]{2}\.json$/` discipline every one of the 14 catalogs' own (now-removed) per-country loader
 * already held), and each section PRESENT in a country's file is validated HERE, once, with that
 * section's own, unchanged validator (`assertValidProvenance`, `assertValidVatRateProvenance`, …) -
 * the exact function each catalog's own `data/<cc>.json`-reading loader used to call on its own file,
 * before this step physically moved the data. A section absent from a country's file is `undefined`,
 * never guessed or defaulted - the same "no permissive fallback" discipline every one of the 14
 * catalogs already held on its own.
 *
 * Every one of the 14 catalogs' own `data/all.ts` still exists and still exports its own
 * `ALL_XXX_FILES` array, for the handful of callers (tests, `country-readiness.service.ts`,
 * `reporting/list-declarations.ts`, …) that import it directly instead of going through that
 * catalog's `registry.ts` - but it no longer reads any file itself: it derives its array from
 * `defaultComposedCountryCatalog` (`../registry.ts`), which is built from THIS loader's own output.
 * See each one's own header for why it still exists and what it now does instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ComposedCountryView } from '../compose';

import { assertValidNumberFormats } from '../../country-policy/number-formats';
import {
  assertValidDocumentValidationCodeFact,
  assertValidDomesticInvoiceCurrencyFact,
  assertValidInvoiceValidationFact,
  assertValidNumberingProvenance,
  assertValidProvenance as assertValidPolicyProvenance,
  assertValidRevenueBasisDefaultFact,
} from '../../country-policy/schema';
import {
  assertPatternIsExplainable,
  assertValidProvenance as assertValidIdentifierProvenance,
} from '../../country-identifiers/schema';
import { assertValidCorrectionRouteFact } from '../../correction-routes/schema';
import { assertValidVatRateProvenance } from '../../vat-rates/schema';
import { assertValidTaxSystemProvenance } from '../../tax/tax-systems/schema';
import { assertValidVatCurrencyRule } from '../../vat-currency/schema';
import { assertValidChannelPolicyFact } from '../../transports/channel-policy/schema';
import { assertValidRetentionRule } from '../../archive/retention/schema';
import { assertValidMentionRule } from '../../mentions/schema';
import { assertValidLocalizedMentions } from '../../tax/localized-mentions';
import { assertValidReportingObligationFact } from '../../reporting/schema';
import { assertValidDomesticReverseChargeCategory } from '../../domestic-reverse-charge/schema';
import { assertValidCountryFields } from '../../country-fields/schema';
import { assertValidContentRequirementFact } from '../../content-requirements/schema';
import { assertValidB2gRoutingFact } from '../../b2g-routing/schema';
import { assertValidPaymentTerms } from '../../payment-terms/schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file in `dir`, sorted for a deterministic load order -
 *  the same discovery discipline every one of the 14 catalogs' own (now-removed) per-country loader
 *  already held for its own directory, one level up. Takes `dir` explicitly so tests can use an
 *  isolated directory. */
function discoverCountryCodes(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

interface LoadContext {
  path: string;
  countryCode: string;
}

/** One section of a mismatched `countryCode`: the same load-time sanity check every one of the 14
 *  catalogs' own (now-removed) per-country loader already ran on its own file, generalized to a
 *  named section of the single merged file. */
function assertSectionCountryCode(
  section: { countryCode: string },
  sectionKey: string,
  context: LoadContext,
): void {
  if (section.countryCode !== context.countryCode) {
    throw new Error(
      `${context.path}: "${sectionKey}.countryCode" ("${section.countryCode}") must match the file's own ` +
        `"countryCode" ("${context.countryCode}")`,
    );
  }
}

// Each `validateXSection` validates exactly one top-level key, split out to keep each one small.

function validatePolicySection(
  policy: ComposedCountryView['policy'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!policy) return;
  assertSectionCountryCode(policy, 'policy', ctx);
  if (!Array.isArray(policy.documentTypes) || policy.documentTypes.length === 0) {
    throw new Error(
      `${filePath} must declare a non-empty "policy.documentTypes" array - see schema.ts's own comment on that field.`,
    );
  }
  for (const rule of policy.rules) {
    assertValidPolicyProvenance(rule, `${filePath}#policy`);
  }
  // `numbering` (issue #471) - optional, present entries get the same load-time provenance gate
  // `rules` above already holds.
  for (const fact of policy.numbering ?? []) {
    assertValidNumberingProvenance(fact, `${filePath}#policy`);
  }
  // `numberFormats` (issue #496) - REQUIRED for every shipped file: numbering reads its format
  // from here and nowhere else, so a country without one could not number anything at all.
  if (!policy.numberFormats) {
    throw new Error(
      `${filePath} must declare "policy.numberFormats" - see schema.ts's own comment on that field.`,
    );
  }
  assertValidNumberFormats(policy, `${filePath}#policy`);
  if (policy.domesticInvoiceCurrency) {
    assertValidDomesticInvoiceCurrencyFact(policy.domesticInvoiceCurrency, `${filePath}#policy`);
  }
  if (policy.invoiceValidation) {
    assertValidInvoiceValidationFact(policy.invoiceValidation, `${filePath}#policy`);
  }
  if (policy.documentValidationCode) {
    assertValidDocumentValidationCodeFact(policy.documentValidationCode, `${filePath}#policy`);
  }
  if (policy.revenueBasisDefault) {
    assertValidRevenueBasisDefaultFact(policy.revenueBasisDefault, `${filePath}#policy`);
  }
}

function validateIdentifiersSection(
  identifiers: ComposedCountryView['identifiers'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!identifiers) return;
  assertSectionCountryCode(identifiers, 'identifiers', ctx);
  for (const fact of identifiers.schemes) {
    assertValidIdentifierProvenance(fact, `${filePath}#identifiers`);
    assertPatternIsExplainable(fact, `${filePath}#identifiers`);
  }
}

function validateCorrectionRoutesSection(
  correctionRoutes: ComposedCountryView['correctionRoutes'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!correctionRoutes) return;
  assertSectionCountryCode(correctionRoutes, 'correctionRoutes', ctx);
  for (const route of correctionRoutes.routes) {
    assertValidCorrectionRouteFact(route, `${filePath}#correctionRoutes`);
  }
}

function validateVatRatesSection(
  vatRates: ComposedCountryView['vatRates'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!vatRates) return;
  assertSectionCountryCode(vatRates, 'vatRates', ctx);
  for (const rate of vatRates.rates) {
    assertValidVatRateProvenance(rate, `${filePath}#vatRates`);
  }
}

function validateTaxSystemSection(
  taxSystem: ComposedCountryView['taxSystem'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!taxSystem) return;
  assertSectionCountryCode(taxSystem, 'taxSystem', ctx);
  assertValidTaxSystemProvenance(taxSystem, `${filePath}#taxSystem`);
}

function validateVatCurrencySection(
  vatCurrency: ComposedCountryView['vatCurrency'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!vatCurrency) return;
  assertSectionCountryCode(vatCurrency, 'vatCurrency', ctx);
  assertValidVatCurrencyRule(vatCurrency, `${filePath}#vatCurrency`);
}

function validateChannelPolicySection(
  channelPolicy: ComposedCountryView['channelPolicy'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!channelPolicy) return;
  assertSectionCountryCode(channelPolicy, 'channelPolicy', ctx);
  for (const fact of channelPolicy.facts) {
    assertValidChannelPolicyFact(fact, `${filePath}#channelPolicy`);
  }
}

function validateRetentionSection(
  retention: ComposedCountryView['retention'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!retention) return;
  assertSectionCountryCode(retention, 'retention', ctx);
  for (const rule of retention.rules ?? []) {
    assertValidRetentionRule(rule, `${filePath}#retention`);
  }
}

function validateMentionsSection(
  mentions: ComposedCountryView['mentions'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!mentions) return;
  assertSectionCountryCode(mentions, 'mentions', ctx);
  for (const entry of mentions.invoiceNotes ?? []) {
    assertValidMentionRule(entry, `${filePath}#mentions`);
  }
}

function validateLocalizedMentionsSection(
  localizedMentions: ComposedCountryView['localizedMentions'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!localizedMentions) return;
  assertSectionCountryCode(localizedMentions, 'localizedMentions', ctx);
  assertValidLocalizedMentions(localizedMentions, `${filePath}#localizedMentions`);
}

function validateReportingSection(
  reporting: ComposedCountryView['reporting'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!reporting) return;
  assertSectionCountryCode(reporting, 'reporting', ctx);
  for (const fact of reporting.facts) {
    assertValidReportingObligationFact(fact, `${filePath}#reporting`);
  }
}

function validateDomesticReverseChargeSection(
  domesticReverseCharge: ComposedCountryView['domesticReverseCharge'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!domesticReverseCharge) return;
  assertSectionCountryCode(domesticReverseCharge, 'domesticReverseCharge', ctx);
  for (const category of domesticReverseCharge.categories ?? []) {
    assertValidDomesticReverseChargeCategory(category, `${filePath}#domesticReverseCharge`);
  }
}

function validateCountryFieldsSection(
  countryFields: ComposedCountryView['countryFields'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!countryFields) return;
  assertSectionCountryCode(countryFields, 'countryFields', ctx);
  assertValidCountryFields(countryFields, `${filePath}#countryFields`);
}

function validateContentRequirementsSection(
  contentRequirements: ComposedCountryView['contentRequirements'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!contentRequirements) return;
  assertSectionCountryCode(contentRequirements, 'contentRequirements', ctx);
  for (const fact of contentRequirements.facts ?? []) {
    assertValidContentRequirementFact(fact, `${filePath}#contentRequirements`);
  }
}

function validateB2gRoutingSection(
  b2gRouting: ComposedCountryView['b2gRouting'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!b2gRouting) return;
  assertSectionCountryCode(b2gRouting, 'b2gRouting', ctx);
  assertValidB2gRoutingFact(b2gRouting, `${filePath}#b2gRouting`);
}

function validatePaymentTermsSection(
  paymentTerms: ComposedCountryView['paymentTerms'],
  ctx: LoadContext,
  filePath: string,
): void {
  if (!paymentTerms) return;
  assertSectionCountryCode(paymentTerms, 'paymentTerms', ctx);
  assertValidPaymentTerms(paymentTerms, `${filePath}#paymentTerms`);
}

function loadCountryFile(dir: string, code: string): ComposedCountryView {
  const path = join(dir, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as ComposedCountryView;
  const filePath = `documents/countries/data/${code}.json`;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `${filePath} declares countryCode "${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  const ctx = { path: filePath, countryCode: parsed.countryCode };

  validatePolicySection(parsed.policy, ctx, filePath);
  validateIdentifiersSection(parsed.identifiers, ctx, filePath);
  validateCorrectionRoutesSection(parsed.correctionRoutes, ctx, filePath);
  validateVatRatesSection(parsed.vatRates, ctx, filePath);
  validateTaxSystemSection(parsed.taxSystem, ctx, filePath);
  validateVatCurrencySection(parsed.vatCurrency, ctx, filePath);
  validateChannelPolicySection(parsed.channelPolicy, ctx, filePath);
  validateRetentionSection(parsed.retention, ctx, filePath);
  validateMentionsSection(parsed.mentions, ctx, filePath);
  validateLocalizedMentionsSection(parsed.localizedMentions, ctx, filePath);
  validateReportingSection(parsed.reporting, ctx, filePath);
  validateDomesticReverseChargeSection(parsed.domesticReverseCharge, ctx, filePath);
  validateCountryFieldsSection(parsed.countryFields, ctx, filePath);
  validateContentRequirementsSection(parsed.contentRequirements, ctx, filePath);
  validateB2gRoutingSection(parsed.b2gRouting, ctx, filePath);
  validatePaymentTermsSection(parsed.paymentTerms, ctx, filePath);

  return parsed;
}

/** Discovers and validates every `<cc>.json` file in `dir` - parameterized so a test can point this
 *  at an isolated directory instead of the real one, which other specs read concurrently. */
export function loadComposedCountryFilesFrom(dir: string): ComposedCountryView[] {
  return discoverCountryCodes(dir).map((code) => loadCountryFile(dir, code));
}

/** One validated composed view per country with a `countries/data/<cc>.json` file - see this
 *  module's own header. This is the single source `compose.ts#ALL_COMPOSED_COUNTRIES` re-exports,
 *  and the single source every one of the 14 catalogs' own (now-derived) `ALL_XXX_FILES` ultimately
 *  comes from, through `defaultComposedCountryCatalog`. */
export const ALL_COMPOSED_COUNTRY_FILES: ComposedCountryView[] = loadComposedCountryFilesFrom(__dirname);

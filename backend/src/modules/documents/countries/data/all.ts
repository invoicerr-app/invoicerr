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
  assertValidDomesticInvoiceCurrencyFact,
  assertValidInvoiceValidationFact,
  assertValidNumberingProvenance,
  assertValidProvenance as assertValidPolicyProvenance,
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
import { assertValidReportingObligationFact } from '../../reporting/schema';
import { assertValidDomesticReverseChargeCategory } from '../../domestic-reverse-charge/schema';
import { assertValidCountryFields } from '../../country-fields/schema';
import { assertValidContentRequirementFact } from '../../content-requirements/schema';
import { assertValidB2gRoutingFact } from '../../b2g-routing/schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order - the same discovery discipline every one of the 14 catalogs' own (now-removed)
 *  per-country loader already held for its own directory, one level up. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
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

function loadCountryFile(code: string): ComposedCountryView {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as ComposedCountryView;
  const filePath = `documents/countries/data/${code}.json`;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `${filePath} declares countryCode "${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  const ctx = { path: filePath, countryCode: parsed.countryCode };

  if (parsed.policy) {
    const policy = parsed.policy;
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
  }

  if (parsed.identifiers) {
    const identifiers = parsed.identifiers;
    assertSectionCountryCode(identifiers, 'identifiers', ctx);
    for (const fact of identifiers.schemes) {
      assertValidIdentifierProvenance(fact, `${filePath}#identifiers`);
      assertPatternIsExplainable(fact, `${filePath}#identifiers`);
    }
  }

  if (parsed.correctionRoutes) {
    const correctionRoutes = parsed.correctionRoutes;
    assertSectionCountryCode(correctionRoutes, 'correctionRoutes', ctx);
    for (const route of correctionRoutes.routes) {
      assertValidCorrectionRouteFact(route, `${filePath}#correctionRoutes`);
    }
  }

  if (parsed.vatRates) {
    const vatRates = parsed.vatRates;
    assertSectionCountryCode(vatRates, 'vatRates', ctx);
    for (const rate of vatRates.rates) {
      assertValidVatRateProvenance(rate, `${filePath}#vatRates`);
    }
  }

  if (parsed.taxSystem) {
    assertSectionCountryCode(parsed.taxSystem, 'taxSystem', ctx);
    assertValidTaxSystemProvenance(parsed.taxSystem, `${filePath}#taxSystem`);
  }

  if (parsed.vatCurrency) {
    assertSectionCountryCode(parsed.vatCurrency, 'vatCurrency', ctx);
    assertValidVatCurrencyRule(parsed.vatCurrency, `${filePath}#vatCurrency`);
  }

  if (parsed.channelPolicy) {
    const channelPolicy = parsed.channelPolicy;
    assertSectionCountryCode(channelPolicy, 'channelPolicy', ctx);
    for (const fact of channelPolicy.facts) {
      assertValidChannelPolicyFact(fact, `${filePath}#channelPolicy`);
    }
  }

  if (parsed.retention) {
    const retention = parsed.retention;
    assertSectionCountryCode(retention, 'retention', ctx);
    for (const rule of retention.rules ?? []) {
      assertValidRetentionRule(rule, `${filePath}#retention`);
    }
  }

  if (parsed.mentions) {
    const mentions = parsed.mentions;
    assertSectionCountryCode(mentions, 'mentions', ctx);
    for (const entry of mentions.invoiceNotes ?? []) {
      assertValidMentionRule(entry, `${filePath}#mentions`);
    }
  }

  if (parsed.reporting) {
    const reporting = parsed.reporting;
    assertSectionCountryCode(reporting, 'reporting', ctx);
    for (const fact of reporting.facts) {
      assertValidReportingObligationFact(fact, `${filePath}#reporting`);
    }
  }

  if (parsed.domesticReverseCharge) {
    const domesticReverseCharge = parsed.domesticReverseCharge;
    assertSectionCountryCode(domesticReverseCharge, 'domesticReverseCharge', ctx);
    for (const category of domesticReverseCharge.categories ?? []) {
      assertValidDomesticReverseChargeCategory(category, `${filePath}#domesticReverseCharge`);
    }
  }

  if (parsed.countryFields) {
    assertSectionCountryCode(parsed.countryFields, 'countryFields', ctx);
    assertValidCountryFields(parsed.countryFields, `${filePath}#countryFields`);
  }

  if (parsed.contentRequirements) {
    const contentRequirements = parsed.contentRequirements;
    assertSectionCountryCode(contentRequirements, 'contentRequirements', ctx);
    for (const fact of contentRequirements.facts ?? []) {
      assertValidContentRequirementFact(fact, `${filePath}#contentRequirements`);
    }
  }

  if (parsed.b2gRouting) {
    assertSectionCountryCode(parsed.b2gRouting, 'b2gRouting', ctx);
    assertValidB2gRoutingFact(parsed.b2gRouting, `${filePath}#b2gRouting`);
  }

  return parsed;
}

/** One validated composed view per country with a `countries/data/<cc>.json` file - see this
 *  module's own header. This is the single source `compose.ts#ALL_COMPOSED_COUNTRIES` re-exports,
 *  and the single source every one of the 14 catalogs' own (now-derived) `ALL_XXX_FILES` ultimately
 *  comes from, through `defaultComposedCountryCatalog`. */
export const ALL_COMPOSED_COUNTRY_FILES: ComposedCountryView[] = discoverCountryCodes().map(loadCountryFile);

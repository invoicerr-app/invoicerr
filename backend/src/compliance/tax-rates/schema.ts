/**
 * The VAT Rate Catalog — a per-country, human-maintained list of the VAT rates a business in that
 * country can actually pick from (COMPLIANCE_ARCHITECTURE.md's "a country is data" principle,
 * applied to rates instead of regimes).
 *
 * This catalog is presentation data for the invoice/quote line-item form (P?-T?? "TVA list, not a
 * free number" — see the frontend `VatRateField`). It is NOT a second tax authority: the engine
 * that actually determines tax (`engine/tax-engine.ts`) reads `CountryComplianceProfile.taxSystem`
 * (`standardRate` / `reducedRates`), never this catalog. `consistency.spec.ts` in this directory
 * fails CI if the two drift apart, which is the guard against this catalog becoming a second,
 * contradicting truth.
 *
 * Every entry is `Temporal<VatRateFact>` — the exact same `{ validFrom, validTo, value }` shape
 * `profiles/temporal.ts` already defines for regime/format/transmission rules — so `pickByDate` /
 * `allByDate` apply unchanged. Rates change over time (France's 19.6% -> 20% on 2014-01-01 is the
 * textbook example) and the model has to be able to say that, exactly like the rest of the
 * compliance module.
 */
import type { Temporal } from '../profiles/schema';

/**
 * A coarse, user-facing bucket — NOT the EN 16931 BT-151 category code (`S`/`Z`/`E`/`AE`/`K`/`G`/`O`,
 * see `types.ts` `TaxCategoryCode`). That code is a legal-invoice classification the engine derives;
 * this one is "where does this rate sit in the country's rate ladder", for a dropdown to group by.
 * A country with more than one rate below "standard" (France has three: 10 / 5.5 / 2.1) places the
 * ones below its ordinary reduced rate under SUPER_REDUCED — the `label` field carries the exact
 * official term (e.g. "Taux particulier"), this field only carries the ranking.
 */
export type VatRateCategory = 'STANDARD' | 'REDUCED' | 'SUPER_REDUCED' | 'ZERO' | 'EXEMPT';

/**
 * OFFICIAL: the rate value is sourced to a named law or tax-administration page and not in doubt.
 * UNVERIFIED: sourced as far as it goes, but something about it (usually the exact figure or its
 * applicability) still needs a primary-source check before this should be trusted — never omit
 * `notes` on an UNVERIFIED entry; it must say what would settle it.
 */
export type VatRateConfidence = 'OFFICIAL' | 'UNVERIFIED';

export interface VatRateFact {
  /** Stable slug, unique within the country file, e.g. "fr-standard". Survives rate/label changes
   *  across time — it identifies the CONCEPT (the standard rate), not a specific number — so a rate
   *  change over time is a second Temporal entry with the SAME id and a later `validFrom`, not a
   *  new id. This is also the seed's idempotency key (with countryCode + validFrom). */
  id: string;
  /** Percentage, e.g. 20 for 20%. */
  rate: number;
  /** Human label, the country's own official term where one exists (e.g. "Taux normal"). Shown to
   *  the user as-is — it is DATA, like a client or article name, not application chrome, so it is
   *  deliberately NOT run through i18n `t()`. */
  label: string;
  category: VatRateCategory;
  confidence: VatRateConfidence;
  /** The legal text or administration page this was read from. */
  source: string;
  /** ISO date this entry was last checked against `source`. */
  sourceCheckedAt: string;
  /** Caveats, mechanism explanations (e.g. "this is a decree-based credit, not a rate-table entry"),
   *  or — for UNVERIFIED entries — what would have to be read to confirm the figure. */
  notes?: string;
}

export interface CountryVatRatesFile {
  countryCode: string; // ISO 3166-1 alpha-2, uppercase — must match the file's own name
  rates: Temporal<VatRateFact>[];
}

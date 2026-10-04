/**
 * The Tax Determination Engine (cross-border tax). CARRIED OVER almost verbatim from
 * `compliance/engine/tax-engine.ts` (git tag `avant-refonte-documents`, `COMPLIANCE_ARCHITECTURE.md`
 * §9 in that lineage) — a pure, deterministic cascade over (supplier tax system, buyer, same
 * country?, same union?, role, supply type, VAT validity) producing a per-line `TaxTreatment`. This
 * is where FR→IT, US→FR, FR→US are actually decided — by *composition* of the two countries, never a
 * country-pair special case (`classification.ts#taxUnionOf`, a TABLE, never an N² map of pairs).
 *
 * ONLY the import paths changed (this module's own `./types`/`./classification` rather than the
 * removed `../canonical/canonical-document`/`../profiles/schema`) — every mention TEXT, every branch,
 * every comment below is the reference's own, unedited. `resolve-invoice-tax.ts` is the wiring that
 * calls this pure engine from the actual "send" flow, decides roles from a
 * REAL stored VAT-validation verdict, and adds the stricter no-silent-fallback guards (unresolved
 * buyer country, OSS with no destination rate table) the product's own history required — see that
 * file's own header. This file stays exactly what it was at the reference: a pure function of its
 * inputs, never aware of Prisma, of "sending", or of any HTTP call.
 *
 * TWO amendments, since the reference, all additive (every existing branch, mention and comment not
 * mentioned below is still the reference's own, unedited):
 *
 * 1. A country whose statute NAMES the exact expression an invoice must carry for a situation above
 *    (small-business exemption, reverse charge, export, intra-Community supply) declares it in its
 *    own `countries/data/<cc>.json` under `localizedMentions`; `localizedMention` below reads it and
 *    falls back to the generic Directive-citing `MENTION` text when the country has no entry.
 * 2. (2026-09-21) The reference's "B2C across the union" branch taxed EVERY such sale of goods in the
 *    BUYER's country, from the first euro. That is only half of Directive 2006/112/EC: art. 59c(1)
 *    disapplies art. 33(a) below a EUR 10 000 per-seller, per-calendar-year, all-member-states-combined
 *    threshold, leaving art. 32 (the seller's own country) to govern. The branch now reads the seller's
 *    OWN DECLARED `PartyTaxProfile.distanceSalesRegime` — see `types.ts` for the articles quoted in
 *    full, the branch itself for what each value does, and `resolve-invoice-tax.ts` for the named block
 *    that refuses to run this branch at all on a seller who has declared nothing. `ossDestinationVat`
 *    below is untouched, including the rate it can and cannot resolve (see its own comment).
 */
import {
  DocumentLine,
  LegalMention,
  PartyTaxProfile,
  ReportingKind,
  TaxCategoryCode,
  TaxComponent,
  TaxTreatment,
  TransactionContext,
  CountryTaxSystemProfile,
  SalesTaxSystemSpec,
  VatSystemSpec,
} from './types';
import { TaxUnion, VatValidator, taxUnionOf } from './classification';
import { LocalizableSituation } from './localized-mentions';
import { defaultComposedCountryCatalog } from '../countries/registry';

const MENTION = {
  reverseCharge: {
    code: 'REVERSE_CHARGE',
    text: 'Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC',
  },
  intraComm: {
    code: 'INTRA_COMMUNITY',
    text: 'Intra-Community supply — Art. 138 Directive 2006/112/EC',
  },
  exportGoods: { code: 'EXPORT', text: 'Export — zero-rated, Art. 146 Directive 2006/112/EC' },
  outOfScope: {
    code: 'OUT_OF_SCOPE',
    text: 'VAT not applicable — supply outside the scope of EU VAT',
  },
  franchise: { code: 'FRANCHISE', text: 'VAT exempt — small business scheme' },
  importSelfAssess: {
    code: 'IMPORT_SELF_ASSESS',
    text: 'Buyer to self-assess VAT on import (reverse charge in destination country)',
  },
  noTaxSystem: {
    code: 'NO_TAX_SYSTEM',
    text: "No VAT or equivalent turnover tax exists in the supplier's country",
  },
  usNoNexus: {
    code: 'US_NO_NEXUS',
    text: 'No sales tax collected — no nexus in destination state (buyer may owe use tax)',
  },
} as const;

/** The generic `MENTION` entries a country's own statute can override with a prescribed wording; the
 *  others are this engine's own descriptive text for situations no state's invoicing law words. */
const generic = {
  reverseCharge: MENTION.reverseCharge,
  intraComm: MENTION.intraComm,
  exportGoods: MENTION.exportGoods,
  franchise: MENTION.franchise,
} as const satisfies Record<LocalizableSituation, LegalMention>;

/** A country's own prescribed wording for one situation, or the generic `MENTION` entry when its data
 *  declares none. */
export function localizedMention(situation: LocalizableSituation, countryCode: string): LegalMention {
  const fact = defaultComposedCountryCatalog.get(countryCode)?.localizedMentions?.situations[situation];
  return fact ? { code: fact.code, text: fact.text } : generic[situation];
}

function treatment(
  component: TaxComponent,
  buyerSelfAssess: boolean,
  reportingFlags: ReportingKind[],
  mentions: LegalMention[],
): TaxTreatment {
  return { components: [component], buyerSelfAssess, reportingFlags, mentions };
}

export function determineLineTax(
  supplier: PartyTaxProfile,
  buyer: PartyTaxProfile,
  line: DocumentLine,
  supplierProfile: CountryTaxSystemProfile,
  vat: VatValidator,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  const sys = supplierProfile.taxSystem;
  const sCountry = supplier.countryCode.toUpperCase();
  const bCountry = buyer.countryCode.toUpperCase();
  const sameCountry = sCountry === bCountry;
  const sUnion = taxUnionOf(sCountry);
  const inSameUnion = !!sUnion && sUnion === taxUnionOf(bCountry);

  // 0. Supplier has no VAT system.
  if (sys.kind === 'SALES_TAX') return salesTax(supplier, buyer, sys, buyerProfile);
  if (sys.kind === 'NONE') {
    return treatment(
      {
        taxSystem: 'NONE',
        name: 'None',
        category: 'O',
        rate: 0,
        jurisdiction: sCountry,
        reason: MENTION.noTaxSystem.text,
      },
      false,
      [],
      [MENTION.noTaxSystem],
    );
  }

  // --- VAT / GST world ---
  // 1. Domestic.
  if (sameCountry) return domesticVat(line, sys, supplier);

  // 2. Cross-border within the same tax union (EU↔EU, GCC↔GCC).
  if (inSameUnion) {
    if (buyer.role === 'B2B' && vat.hasValidVat(buyer)) {
      if (line.supplyType === 'GOODS') {
        return treatment(
          {
            taxSystem: sys.kind,
            name: 'VAT',
            category: 'K',
            rate: 0,
            reason: 'VATEX-EU-IC',
            jurisdiction: sCountry,
          },
          false,
          ['EC_SALES_LIST', 'INTRASTAT'],
          [localizedMention('intraComm', sCountry)],
        );
      }
      // Services (and digital) B2B → reverse charge in the buyer's country.
      return treatment(
        {
          taxSystem: sys.kind,
          name: 'VAT',
          category: 'AE',
          rate: 0,
          reason: 'VATEX-EU-AE',
          jurisdiction: bCountry,
        },
        true,
        ['EC_SALES_LIST'],
        [localizedMention('reverseCharge', sCountry)],
      );
    }
    // B2C across the union (distance sales of goods, and the telecommunications/broadcasting/
    // electronic services art. 58 groups with them) → the SELLER's OWN DECLARED regime decides which
    // member state taxes this, because the two countries alone cannot: see
    // `types.ts#DistanceSalesRegime` for Directive 2006/112/EC arts. 32, 33(a) and 59c quoted in full,
    // and for why the EUR 10 000 threshold behind them is a per-seller running total this engine must
    // never compute or guess.
    //   - ORIGIN — art. 59c(1) disapplies art. 33(a)/art. 58, so art. 32's general rule governs and the
    //     supply is taxed in the SELLER's own member state at the SELLER's own rate. That is exactly
    //     `domesticVat`, the same branch a domestic sale of the same goods takes — `taxRateHint`
    //     included, so a reduced rate the seller is genuinely entitled to at home survives instead of
    //     being flattened to a standard rate. No 'OSS' reporting flag either: an origin-taxed supply is
    //     declared on the seller's ordinary domestic VAT return, not through the One-Stop-Shop.
    //   - DESTINATION — art. 33(a) (goods) or art. 58 (TBE services): the buyer's member state, whether
    //     because the threshold was crossed (art. 59c(2)) or because the seller opted in (art. 59c(3)).
    //   - UNDECLARED — kept on the DESTINATION branch, deliberately, as this PURE engine's own historic
    //     behaviour (byte-identical to what it did before this field existed), exactly like
    //     `ossDestinationVat`'s own seller-rate fallback below: a property of this function, not a
    //     posture the product ships. `resolve-invoice-tax.ts` refuses an undeclared regime by name
    //     (`UndeclaredDistanceSalesRegimeError`) BEFORE calling this engine, so no real send can reach
    //     it — see that file's own header, "the hard blocks this product's own history required".
    if (line.supplyType === 'GOODS' || line.supplyType === 'DIGITAL') {
      if (supplier.distanceSalesRegime === 'ORIGIN') return domesticVat(line, sys, supplier);
      return ossDestinationVat(sys, bCountry, buyerProfile);
    }
    // Other B2C services across the union → default to taxing where the supplier is.
    return domesticVat(line, sys, supplier);
  }

  // 3. Supplier in a VAT union, buyer OUTSIDE it.
  if (line.supplyType === 'GOODS') {
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'G',
        rate: 0,
        reason: 'VATEX-EU-G',
        jurisdiction: sCountry,
      },
      false,
      ['CUSTOMS_EXPORT'],
      [localizedMention('exportGoods', sCountry)],
    );
  }
  // Services to a non-union country: place of supply is the customer → outside scope for supplier.
  return treatment(
    {
      taxSystem: sys.kind,
      name: 'VAT',
      category: 'O',
      rate: 0,
      reason: 'VATEX-EU-O',
      jurisdiction: bCountry,
    },
    true,
    [],
    [MENTION.outOfScope],
  );
}

function domesticVat(line: DocumentLine, sys: VatSystemSpec, supplier: PartyTaxProfile): TaxTreatment {
  // A country with no `localizedMentions.franchise` entry gets the generic mention, never an invented wording.
  if (supplier.taxScheme === 'FRANCHISE_BASE') {
    const mention = localizedMention('franchise', supplier.countryCode);
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'E',
        rate: 0,
        jurisdiction: supplier.countryCode,
        reason: mention.text,
      },
      false,
      [],
      [mention],
    );
  }
  if (supplier.taxScheme === 'EXEMPT') {
    return treatment(
      {
        taxSystem: sys.kind,
        name: 'VAT',
        category: 'E',
        rate: 0,
        jurisdiction: supplier.countryCode,
        reason: MENTION.franchise.text,
      },
      false,
      [],
      [],
    );
  }
  const rate = zeroByHint(line) ? 0 : (line.taxRateHint ?? sys.standardRate);
  const category = line.taxCategoryHint ?? domesticCategoryFor(rate, sys);
  return treatment(
    {
      taxSystem: sys.kind,
      name: 'VAT',
      category,
      rate,
      jurisdiction: supplier.countryCode,
      reason: NEEDS_EXEMPTION_REASON.has(category) ? line.taxExemptionReasonHint : undefined,
    },
    false,
    [],
    [],
  );
}

/** Categories that mean "no VAT is charged on this line". They all imply a 0 rate. */
const UNTAXED_HINTS: ReadonlySet<TaxCategoryCode> = new Set(['Z', 'E', 'O']);

/** Which declared categories carry an exemption reason through to the document. */
const NEEDS_EXEMPTION_REASON: ReadonlySet<TaxCategoryCode> = new Set(['E', 'O']);

function zeroByHint(line: DocumentLine): boolean {
  return !!line.taxCategoryHint && UNTAXED_HINTS.has(line.taxCategoryHint);
}

/** The category of a DOMESTIC line, when nobody has declared one — see the reference's own, much
 *  longer comment here (git tag `avant-refonte-documents:backend/src/compliance/engine/
 *  classification.ts`) for the full reasoning on why a bare 0 rate cannot pick between Z/E/O on its
 *  own, and why `hasDomesticZeroRate === false` answers `E` (fails loud) rather than `O` (sails
 *  through silently wrong). */
function domesticCategoryFor(rate: number, sys: VatSystemSpec): TaxCategoryCode {
  if (rate > 0) return 'S';
  return sys.hasDomesticZeroRate === false ? 'E' : 'Z';
}

function ossDestinationVat(
  sys: VatSystemSpec,
  destination: string,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  // Charge the destination country's standard rate when we know it; otherwise fall back to the
  // supplier's standard rate (placeholder) — see this reference-ported branch's OWN limitation, and
  // `resolve-invoice-tax.ts`'s header for why the WIRING never lets an invoice reach this fallback in
  // production: it blocks, named, before ever calling this function without a real `buyerProfile`.
  //
  // THE STANDARD RATE IS THE ONLY RATE THIS BRANCH CAN RESOLVE, and that is a KNOWN, UNCLOSED gap, not
  // an oversight: a destination member state's own reduced rate (a book at 7% in Germany rather than
  // 19%) depends on WHAT is being sold, and neither half of the input exists — `CountryTaxSystemFact`
  // carries no sourced `reducedRates` for DE/IT/PL/PT (each `tax-systems/data/*.json` says so in its
  // own notes) and `DocumentLine` carries no product classification (a CN/CPA code, an Annex III
  // category) a reduced rate could be selected against even if it did. Applying the destination's
  // standard rate to a reduced-rated product OVER-charges the consumer. `resolve-invoice-tax.ts`
  // states that, per invoice, as a named non-fatal warning rather than leaving it silent — closing it
  // for real needs a per-line product classification the invoice does not have today.
  const dest = buyerProfile?.taxSystem;
  const rate =
    dest && dest.kind !== 'SALES_TAX' && dest.kind !== 'NONE' ? dest.standardRate : sys.standardRate;
  return treatment(
    { taxSystem: sys.kind, name: 'VAT (OSS)', category: 'S', rate, jurisdiction: destination },
    false,
    ['OSS'],
    [],
  );
}

function salesTax(
  supplier: PartyTaxProfile,
  buyer: PartyTaxProfile,
  sys: SalesTaxSystemSpec,
  buyerProfile?: CountryTaxSystemProfile,
): TaxTreatment {
  const sCountry = supplier.countryCode.toUpperCase();
  const bCountry = buyer.countryCode.toUpperCase();

  // Cross-border: the US levies no sales tax on exports; the destination handles import taxation.
  if (sCountry !== bCountry) {
    const destUnion: TaxUnion | null = taxUnionOf(bCountry);
    const destIsVat =
      !!destUnion || buyerProfile?.taxSystem.kind === 'VAT' || buyerProfile?.taxSystem.kind === 'GST';
    return treatment(
      {
        taxSystem: 'SALES_TAX',
        name: 'Sales Tax',
        category: 'O',
        rate: 0,
        jurisdiction: sCountry,
        reason: MENTION.outOfScope.text,
      },
      destIsVat,
      [],
      destIsVat ? [MENTION.importSelfAssess] : [],
    );
  }

  // Domestic US: destination-based; collect only where the seller has nexus.
  const state = (buyer.address?.subdivision ?? '').toUpperCase();
  const hasNexus = !!sys.nexusSubdivisions?.map((s) => s.toUpperCase()).includes(state);
  if (!state || !hasNexus) {
    return treatment(
      {
        taxSystem: 'SALES_TAX',
        name: 'Sales Tax',
        category: 'O',
        rate: 0,
        jurisdiction: bCountry,
        subdivision: state || undefined,
        reason: MENTION.usNoNexus.text,
      },
      false,
      [],
      [MENTION.usNoNexus],
    );
  }
  const rate = sys.stateRates[state] ?? 0;
  return treatment(
    {
      taxSystem: 'SALES_TAX',
      name: `Sales Tax (${state})`,
      category: rate > 0 ? 'S' : 'O',
      rate,
      jurisdiction: bCountry,
      subdivision: state,
    },
    false,
    [],
    [],
  );
}

export interface DocumentTaxResult {
  lines: { lineId: string; treatment: TaxTreatment }[];
  reportingFlags: ReportingKind[];
  mentions: LegalMention[];
  buyerSelfAssess: boolean;
}

/** Determine tax for every line and aggregate document-level flags and mentions. */
export function determineTax(
  ctx: TransactionContext,
  supplierProfile: CountryTaxSystemProfile,
  vat: VatValidator,
  buyerProfile?: CountryTaxSystemProfile,
): DocumentTaxResult {
  const lines = ctx.lines.map((line) => ({
    lineId: line.id,
    treatment: determineLineTax(ctx.supplier, ctx.buyer, line, supplierProfile, vat, buyerProfile),
  }));

  const flags = new Set<ReportingKind>();
  const mentions: LegalMention[] = [];
  const seen = new Set<string>();
  let buyerSelfAssess = false;

  for (const { treatment: t } of lines) {
    for (const f of t.reportingFlags) flags.add(f);
    t.mentions.forEach((m) => {
      if (!seen.has(m.code)) {
        seen.add(m.code);
        mentions.push(m);
      }
    });
    if (t.buyerSelfAssess) buyerSelfAssess = true;
  }

  return { lines, reportingFlags: [...flags], mentions, buyerSelfAssess };
}

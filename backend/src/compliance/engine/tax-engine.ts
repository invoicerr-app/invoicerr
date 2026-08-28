/**
 * The Tax Determination Engine — COMPLIANCE_ARCHITECTURE.md §9.
 * A pure, deterministic cascade over (supplier tax system, buyer, same country?, same union?, role,
 * supply type, VAT validity) producing a per-line TaxTreatment. This is where FR→IT, US→FR, FR→US
 * are actually decided — by *composition* of the two countries, never a country-pair special case.
 */
import {
  DocumentLine,
  LegalMention,
  PartyTaxProfile,
  TaxComponent,
  TaxTreatment,
  TransactionContext,
} from '../canonical/canonical-document';
import { CountryComplianceProfile, SalesTaxSystemSpec, VatSystemSpec } from '../profiles/schema';
import { ReportingKind, TaxCategoryCode } from '../types';
import { TaxUnion, VatValidator, taxUnionOf } from './classification';

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
  fr293b: { code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' },
  franchise: { code: 'FRANCHISE', text: 'VAT exempt — small business scheme' },
  importSelfAssess: {
    code: 'IMPORT_SELF_ASSESS',
    text: 'Buyer to self-assess VAT on import (reverse charge in destination country)',
  },
  usNoNexus: {
    code: 'US_NO_NEXUS',
    text: 'No sales tax collected — no nexus in destination state (buyer may owe use tax)',
  },
} as const;

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
  supplierProfile: CountryComplianceProfile,
  vat: VatValidator,
  buyerProfile?: CountryComplianceProfile,
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
      { taxSystem: 'NONE', name: 'None', category: 'O', rate: 0, jurisdiction: sCountry },
      false,
      [],
      [],
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
          [MENTION.intraComm],
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
        [MENTION.reverseCharge],
      );
    }
    // B2C across the union → OSS: destination VAT (distance sales / digital services).
    if (line.supplyType === 'GOODS' || line.supplyType === 'DIGITAL') {
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
      [MENTION.exportGoods],
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
  // Small-business exemption schemes (FR 293 B and generic franchise / exempt).
  if (supplier.taxScheme === 'FRANCHISE_BASE') {
    const mention = supplier.countryCode.toUpperCase() === 'FR' ? MENTION.fr293b : MENTION.franchise;
    return treatment(
      { taxSystem: sys.kind, name: 'VAT', category: 'E', rate: 0, jurisdiction: supplier.countryCode },
      false,
      [],
      [mention],
    );
  }
  if (supplier.taxScheme === 'EXEMPT') {
    return treatment(
      { taxSystem: sys.kind, name: 'VAT', category: 'E', rate: 0, jurisdiction: supplier.countryCode },
      false,
      [],
      [],
    );
  }
  const rate = zeroByHint(line) ? 0 : (line.taxRateHint ?? sys.standardRate);
  const category = line.taxCategoryHint ?? domesticCategoryFor(rate, sys);
  return treatment(
    { taxSystem: sys.kind, name: 'VAT', category, rate, jurisdiction: supplier.countryCode },
    false,
    [],
    [],
  );
}

/** Categories that mean "no VAT is charged on this line". They all imply a 0 rate. */
const UNTAXED_HINTS: ReadonlySet<TaxCategoryCode> = new Set(['Z', 'E', 'O']);

function zeroByHint(line: DocumentLine): boolean {
  return !!line.taxCategoryHint && UNTAXED_HINTS.has(line.taxCategoryHint);
}

/**
 * The category of a DOMESTIC line, when nobody has declared one.
 *
 * A positive rate is `S` and that is not an approximation: EN 16931 uses `S` for the standard rate
 * AND every reduced rate — BT-152 carries the rate, BT-151 only says which regime it belongs to.
 * So the `rate > 0` half of the old expression was already right.
 *
 * The `rate === 0` half was not, and could not be. A 0 rate is the one value that does NOT
 * determine its category: `Z` (zero-rated), `E` (exempt) and `O` (out of scope) all carry it and
 * demand contradictory things of the document — `Z` and `E` require the seller's identifier
 * (BR-Z-02, BR-E-02) while `O` FORBIDS it (BR-O-02); `E` additionally requires an exemption reason
 * (BR-E-10) that `Z` has no place for. Answering `Z` unconditionally, as this did, was a coin flip
 * dressed as a derivation — and it was the wrong side of the flip for France, which has no zero
 * rate at all (see `fr.ts`).
 *
 * So the country decides as far as it can, and no further:
 *   - it HAS a zero rate  → `Z` stays available and stays the answer.
 *   - it has NONE         → `Z` is impossible. The line is untaxed for some other reason, and the
 *                           closest thing the engine can justify is `E` — the exemption. It cannot
 *                           choose between `E` and `O` on its own, so `E` is deliberate: it is the
 *                           one that FAILS LOUDLY, because BR-E-10 will demand a reason the engine
 *                           does not have. `O` would sail through and be silently wrong.
 *   - not established     → the previous answer, unchanged. Reclassifying ~100 unsourced profiles
 *                           on the strength of a missing field would be the same guess in reverse.
 */
function domesticCategoryFor(rate: number, sys: VatSystemSpec): TaxCategoryCode {
  if (rate > 0) return 'S';
  return sys.hasDomesticZeroRate === false ? 'E' : 'Z';
}

function ossDestinationVat(
  sys: VatSystemSpec,
  destination: string,
  buyerProfile?: CountryComplianceProfile,
): TaxTreatment {
  // Charge the destination country's standard rate when we know it; otherwise fall back to the
  // supplier's standard rate (placeholder) and the engine warns via FALLBACK confidence upstream.
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
  buyerProfile?: CountryComplianceProfile,
): TaxTreatment {
  const sCountry = supplier.countryCode.toUpperCase();
  const bCountry = buyer.countryCode.toUpperCase();

  // Cross-border: the US levies no sales tax on exports; the destination handles import taxation.
  if (sCountry !== bCountry) {
    // If the destination is a VAT jurisdiction, flag that its buyer must self-assess import VAT.
    const destUnion: TaxUnion | null = taxUnionOf(bCountry);
    const destIsVat =
      !!destUnion || buyerProfile?.taxSystem.kind === 'VAT' || buyerProfile?.taxSystem.kind === 'GST';
    return treatment(
      { taxSystem: 'SALES_TAX', name: 'Sales Tax', category: 'O', rate: 0, jurisdiction: sCountry },
      destIsVat, // buyer self-assesses in the destination country
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
      },
      false,
      [],
      [MENTION.usNoNexus],
    );
  }
  const rate = sys.stateRates[state] ?? 0;
  // The second rate-to-category derivation, and `Z` was the wrong answer here for a different
  // reason than in `domesticVat`: a sales-tax system has no concept of a zero-RATED supply. A 0
  // here means the subdivision levies no sales tax at all — Oregon, Montana, New Hampshire and
  // Delaware, which `us.ts` records as "absent → 0" — so the supply is OUTSIDE THE SCOPE of the
  // tax, exactly like the no-nexus branch above, which already answers `O`. Reachable, not
  // theoretical: a seller with nexus in one of those four states lands here.
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
  supplierProfile: CountryComplianceProfile,
  vat: VatValidator,
  buyerProfile?: CountryComplianceProfile,
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

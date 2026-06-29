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
import {
  CountryComplianceProfile,
  SalesTaxSystemSpec,
  VatSystemSpec,
} from '../profiles/schema';
import { ReportingKind } from '../types';
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

function domesticVat(
  line: DocumentLine,
  sys: VatSystemSpec,
  supplier: PartyTaxProfile,
): TaxTreatment {
  // Small-business exemption schemes (FR 293 B and generic franchise / exempt).
  if (supplier.taxScheme === 'FRANCHISE_BASE') {
    const mention =
      supplier.countryCode.toUpperCase() === 'FR' ? MENTION.fr293b : MENTION.franchise;
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
  const rate = line.taxCategoryHint === 'Z' ? 0 : line.taxRateHint ?? sys.standardRate;
  const category = line.taxCategoryHint ?? (rate === 0 ? 'Z' : 'S');
  return treatment(
    { taxSystem: sys.kind, name: 'VAT', category, rate, jurisdiction: supplier.countryCode },
    false,
    [],
    [],
  );
}

function ossDestinationVat(
  sys: VatSystemSpec,
  destination: string,
  buyerProfile?: CountryComplianceProfile,
): TaxTreatment {
  // Charge the destination country's standard rate when we know it; otherwise fall back to the
  // supplier's standard rate (placeholder) and the engine warns via FALLBACK confidence upstream.
  const dest = buyerProfile?.taxSystem;
  const rate = dest && dest.kind !== 'SALES_TAX' && dest.kind !== 'NONE' ? dest.standardRate : sys.standardRate;
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
      !!destUnion ||
      (buyerProfile?.taxSystem.kind === 'VAT' || buyerProfile?.taxSystem.kind === 'GST');
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
  return treatment(
    {
      taxSystem: 'SALES_TAX',
      name: `Sales Tax (${state})`,
      category: rate > 0 ? 'S' : 'Z',
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
    t.reportingFlags.forEach((f) => flags.add(f));
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

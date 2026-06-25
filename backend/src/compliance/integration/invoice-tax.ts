import { resolve } from '../engine/compliance-engine';
import { accumulateTotals, decimalsFor } from '../taxsystems/tax-system';
import type { PartyRole, SupplyType } from '../types';

export interface InvoiceTaxLineInput {
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
  supplyType?: SupplyType;
}

export interface InvoiceTaxInput {
  supplierCountryCode?: string;
  supplierExemptVat: boolean;
  supplierVatNumber?: string | null;
  buyerCountryCode?: string;
  buyerRole?: PartyRole;
  buyerVatNumber?: string | null;
  currency: string;
  issueDate: Date;
  discountRate: number;
  items: InvoiceTaxLineInput[];
}

export interface InvoiceTaxResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  itemVatRates: number[];
  warnings: string[];
}

let lineIdCounter = 0;
function nextLineId(): string {
  return `line-${++lineIdCounter}`;
}

export function resolveInvoiceTax(input: InvoiceTaxInput): InvoiceTaxResult {
  const decimals = decimalsFor(input.currency);
  const discountFactor = 1 - input.discountRate / 100;

  // `validated: false` — Company.VAT/Client.VAT are free-text fields nobody checks today (no VIES
  // call exists in this codebase yet). The engine's default TrustFlagVatValidator is conservative by
  // design: only a VAT id with `validated === true` unlocks reverse-charge/zero-rating. Claiming
  // `true` for an unverified string would let anyone type a fake VAT number into a text field and
  // get 0% VAT on a cross-border B2B sale — an under-charge, which is exactly what that validator
  // exists to prevent. Keep the identifier (useful metadata, forward-compatible with a real VIES
  // validator later) but never assert it's been verified.
  const supplierIdentifiers = input.supplierVatNumber
    ? [{ scheme: 'VAT', value: input.supplierVatNumber, validated: false as const }]
    : [];
  const buyerIdentifiers = input.buyerVatNumber
    ? [{ scheme: 'VAT', value: input.buyerVatNumber, validated: false as const }]
    : [];

  const ctx = {
    supplier: {
      legalName: '-',
      countryCode: input.supplierCountryCode ?? '',
      role: 'B2B' as const,
      identifiers: supplierIdentifiers,
      taxScheme: input.supplierExemptVat ? 'FRANCHISE_BASE' as const : undefined,
    },
    buyer: {
      legalName: '-',
      countryCode: input.buyerCountryCode ?? '',
      role: input.buyerRole ?? 'B2B' as const,
      identifiers: buyerIdentifiers,
    },
    lines: input.items.map((item) => ({
      id: nextLineId(),
      description: '',
      quantity: item.quantity,
      unitNetMinor: Math.round((item.unitPrice * discountFactor) * 10 ** decimals),
      supplyType: (item.supplyType ?? 'SERVICES') as SupplyType,
      taxRateHint: item.vatRate ?? undefined,
    })),
    issueDate: input.issueDate,
    currency: input.currency,
  };

  const plan = resolve(ctx);

  const totals = accumulateTotals(ctx, plan.tax);

  const divisor = 10 ** decimals;
  return {
    totalHT: totals.net.minor / divisor,
    totalVAT: totals.tax.minor / divisor,
    totalTTC: totals.gross.minor / divisor,
    itemVatRates: plan.tax.lines.map(
      (l) => l.treatment.components[0]?.rate ?? 0,
    ),
    warnings: plan.warnings,
  };
}

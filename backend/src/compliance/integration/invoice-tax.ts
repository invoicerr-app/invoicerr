import { resolve } from '../engine/compliance-engine';
import type { DocumentTaxResult } from '../engine/tax-engine';
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
  /**
   * C4 — whether the supplier's VAT number has been VERIFIED, from the persisted validation
   * outcome. Absent means never checked, which is not the same as invalid.
   */
  supplierVatValidated?: boolean;
  buyerCountryCode?: string;
  buyerRole?: PartyRole;
  buyerVatNumber?: string | null;
  /** C4 — same, for the buyer. This is the one that unlocks reverse charge. */
  buyerVatValidated?: boolean;
  currency: string;
  issueDate: Date;
  discountRate: number;
  items: InvoiceTaxLineInput[];
}

export interface InvoiceTaxResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  totalsMinor: { netMinor: number; taxMinor: number; grossMinor: number };
  itemVatRates: number[];
  /**
   * C3 — the resolved VAT CATEGORY per line (EN 16931 BT-151: S, Z, E, AE, K, G, O …).
   *
   * The rate alone cannot drive a seller-identifier guard: Z, E, AE, K and G all carry a 0 rate and
   * REQUIRE the seller's identifier, while O carries a 0 rate and FORBIDS it (BR-O-02). A guard
   * keyed on "rate is 0" would be wrong for one of the six.
   */
  itemVatCategories: string[];
  /**
   * BT-121 per line — the engine's own exemption reason code, when it has one.
   *
   * Needed because BR-AE-10, BR-IC-10, BR-G-10 and BR-O-10 each require a reason on the breakdown,
   * and the category does not always fix which: E covers a dozen different exemptions with a dozen
   * different VATEX codes. Carrying the engine's answer avoids the renderer inventing one.
   */
  itemVatExemptionReasons: (string | undefined)[];
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
  // C4 — read from the PERSISTED validation outcome instead of the hardcoded `false` this used to
  // carry. The comment above explains why `false` was chosen and it was right at the time: trusting
  // a free-text VAT field would let anyone type a fake number and get 0%, an under-charge. But the
  // consequence was never written down — categories AE and K became unreachable from the invoice
  // path, so an intra-EU B2B service came out at 20% French VAT instead of reverse-charged
  // (Directive 2006/112 art. 44, CGI art. 259-1°). That is a tax the customer does not owe, on an
  // invoice whose VAT category is wrong.
  //
  // The fix is neither `false` nor `true`: it is knowing whether the number was actually checked.
  // Absent (never validated) still resolves to `false`, so the conservative default is intact for
  // every identifier nobody has verified — the behaviour only changes once a real verdict exists.
  const supplierIdentifiers = input.supplierVatNumber
    ? [{ scheme: 'VAT', value: input.supplierVatNumber, validated: input.supplierVatValidated === true }]
    : [];
  const buyerIdentifiers = input.buyerVatNumber
    ? [{ scheme: 'VAT', value: input.buyerVatNumber, validated: input.buyerVatValidated === true }]
    : [];

  const ctx = {
    supplier: {
      legalName: '-',
      countryCode: input.supplierCountryCode ?? '',
      role: 'B2B' as const,
      identifiers: supplierIdentifiers,
      taxScheme: input.supplierExemptVat ? ('FRANCHISE_BASE' as const) : undefined,
    },
    buyer: {
      legalName: '-',
      countryCode: input.buyerCountryCode ?? '',
      role: input.buyerRole ?? ('B2B' as const),
      identifiers: buyerIdentifiers,
    },
    lines: input.items.map((item) => ({
      id: nextLineId(),
      description: '',
      quantity: item.quantity,
      unitNetMinor: Math.round(item.unitPrice * discountFactor * 10 ** decimals),
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
    totalsMinor: {
      netMinor: totals.net.minor,
      taxMinor: totals.tax.minor,
      grossMinor: totals.gross.minor,
    },
    itemVatRates: plan.tax.lines.map((l) => l.treatment.components[0]?.rate ?? 0),
    itemVatCategories: plan.tax.lines.map((l) => l.treatment.components[0]?.category ?? 'S'),
    itemVatExemptionReasons: plan.tax.lines.map((l) => l.treatment.components[0]?.reason),
    warnings: [...plan.warnings, ...unverifiedVatWarnings(input, plan)],
  };
}

/**
 * C4 — say out loud when VAT is being charged only because a number could not be verified.
 *
 * This is the half of the fix that is not about tax at all. Falling back to the standard rate when
 * a buyer's VAT number is unverified is the right CONSERVATIVE choice — it never under-charges —
 * but doing it silently is not. The user sees 20% on a cross-border B2B invoice and has no way to
 * know it is there because a verification did not happen, nor that verifying the number would
 * remove it.
 *
 * Emitted only where it changes the outcome: a cross-border B2B supply with an unverified buyer
 * number that came out at a positive rate. On a domestic invoice, or one already reverse-charged,
 * the warning would be noise.
 */
function unverifiedVatWarnings(input: InvoiceTaxInput, plan: { tax: DocumentTaxResult }): string[] {
  const supplier = (input.supplierCountryCode ?? '').toUpperCase();
  const buyer = (input.buyerCountryCode ?? '').toUpperCase();
  if (!supplier || !buyer || supplier === buyer) return [];
  if ((input.buyerRole ?? 'B2B') !== 'B2B') return [];
  if (input.buyerVatValidated === true) return [];

  const charged = plan.tax.lines.some((l) => (l.treatment.components[0]?.rate ?? 0) > 0);
  if (!charged) return [];

  return [
    input.buyerVatNumber
      ? `VAT is charged on this cross-border B2B supply because the buyer's VAT number ` +
        `(${input.buyerVatNumber}) has not been verified. Verify it to apply the reverse charge.`
      : 'VAT is charged on this cross-border B2B supply because the buyer has no VAT number on ' +
        'record. Add and verify it to apply the reverse charge.',
  ];
}

import { Money, TransactionContext } from '../canonical/canonical-document';
import { ComplianceLogger } from '../execution/logger';
import { MoneyTotals } from '../execution/types';
import { DocumentTaxResult } from '../engine/tax-engine';
import { TaxSystemKind } from '../types';

/** Computes monetary totals (in integer minor units) from the resolved per-line tax treatment. */
export interface TaxSystemHandler {
  readonly kind: TaxSystemKind;
  computeTotals(ctx: TransactionContext, tax: DocumentTaxResult, log: ComplianceLogger): MoneyTotals;
}

const CURRENCY_DECIMALS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency?.toUpperCase()] ?? 2;
}

export function money(minor: number, currency: string): Money {
  return { minor: Math.round(minor), currency, decimals: decimalsFor(currency) };
}

/** Net + tax + gross by summing line nets and applying each line's tax-component rates. */
export function accumulateTotals(ctx: TransactionContext, tax: DocumentTaxResult): MoneyTotals {
  const currency = ctx.currency;
  let netMinor = 0;
  let taxMinor = 0;
  const byLine = new Map(tax.lines.map((l) => [l.lineId, l.treatment]));
  for (const line of ctx.lines) {
    const lineNet = Math.round(line.unitNetMinor * line.quantity);
    netMinor += lineNet;
    const treatment = byLine.get(line.id);
    if (treatment) {
      for (const c of treatment.components) {
        if (c.rate > 0) taxMinor += Math.round(lineNet * (c.rate / 100));
      }
    }
  }
  return {
    net: money(netMinor, currency),
    tax: money(taxMinor, currency),
    gross: money(netMinor + taxMinor, currency),
  };
}

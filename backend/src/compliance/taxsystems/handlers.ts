import { TransactionContext } from '../canonical/canonical-document';
import { DocumentTaxResult } from '../engine/tax-engine';
import { ComplianceLogger } from '../execution/logger';
import { MoneyTotals } from '../execution/types';
import { TaxSystemKind } from '../types';
import { TaxSystemHandler, accumulateTotals, money } from './tax-system';

/** VAT — fully computed from line nets and per-line VAT components. */
export class VatTaxSystemHandler implements TaxSystemHandler {
  readonly kind: TaxSystemKind = 'VAT';
  computeTotals(ctx: TransactionContext, tax: DocumentTaxResult): MoneyTotals {
    return accumulateTotals(ctx, tax);
  }
}

/** GST — same arithmetic shape as VAT. */
export class GstTaxSystemHandler implements TaxSystemHandler {
  readonly kind: TaxSystemKind = 'GST';
  computeTotals(ctx: TransactionContext, tax: DocumentTaxResult): MoneyTotals {
    return accumulateTotals(ctx, tax);
  }
}

/** Sales tax (US) — destination rate already resolved into components; sum it. Local-rate stacking
 *  (county/city/special district) is a TODO. */
export class SalesTaxSystemHandler implements TaxSystemHandler {
  readonly kind: TaxSystemKind = 'SALES_TAX';
  computeTotals(ctx: TransactionContext, tax: DocumentTaxResult, log: ComplianceLogger): MoneyTotals {
    log.todo('taxsystem/sales-tax', 'add county/city/special-district rate stacking on top of the state rate');
    return accumulateTotals(ctx, tax);
  }
}

/** Consumption tax (JP-style) — placeholder; same shape until JP specifics are added. */
export class ConsumptionTaxSystemHandler implements TaxSystemHandler {
  readonly kind: TaxSystemKind = 'CONSUMPTION_TAX';
  computeTotals(ctx: TransactionContext, tax: DocumentTaxResult, log: ComplianceLogger): MoneyTotals {
    log.todo('taxsystem/consumption-tax', 'implement consumption-tax rounding rules');
    return accumulateTotals(ctx, tax);
  }
}

/** No tax (US sales-tax-free states at document level, or unknown systems). */
export class NoTaxSystemHandler implements TaxSystemHandler {
  readonly kind: TaxSystemKind = 'NONE';
  computeTotals(ctx: TransactionContext): MoneyTotals {
    const netMinor = ctx.lines.reduce((s, l) => s + Math.round(l.unitNetMinor * l.quantity), 0);
    return { net: money(netMinor, ctx.currency), tax: money(0, ctx.currency), gross: money(netMinor, ctx.currency) };
  }
}

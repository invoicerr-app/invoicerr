import { Injectable } from '@nestjs/common';
import { VATRate } from '../interfaces';

export interface VATCalculationInput {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatCode?: string;
}

export interface VATBreakdownItem {
  rate: number;
  code: string;
  category?: string;
  base: number;
  amount: number;
}

export interface VATCalculationResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  breakdown: VATBreakdownItem[];
}

export interface VATEngineRules {
  rates: VATRate[];
  defaultRate: number;
  reverseCharge: boolean;
  roundingMode?: 'line' | 'total';
}

@Injectable()
export class VATEngineService {
  /**
   * Calculate VAT totals according to country rules
   * @param items Invoice line items
   * @param rules VAT rules to apply
   */
  calculate(items: VATCalculationInput[], rules: VATEngineRules): VATCalculationResult {
    const roundingMode = rules.roundingMode || 'total';
    const breakdown = new Map<number, VATBreakdownItem>();

    for (const item of items) {
      const lineTotal = this.round(item.quantity * item.unitPrice);
      const rate = item.vatRate;

      if (!breakdown.has(rate)) {
        const rateInfo = rules.rates.find((r) => r.rate === rate);
        breakdown.set(rate, {
          code: item.vatCode || rateInfo?.code || 'S',
          category: rateInfo?.category || 'standard',
          rate,
          base: 0,
          amount: 0,
        });
      }

      const entry = breakdown.get(rate)!;
      entry.base += lineTotal;

      // Per-line rounding: calculate VAT for each line and sum
      if (roundingMode === 'line' && !rules.reverseCharge) {
        const lineVAT = this.round((lineTotal * rate) / 100);
        entry.amount += lineVAT;
      }
    }

    // Per-total rounding: calculate VAT on total base for each rate
    if (roundingMode === 'total' && !rules.reverseCharge) {
      for (const entry of breakdown.values()) {
        entry.amount = this.round((entry.base * entry.rate) / 100);
      }
    }

    // Reverse charge: VAT = 0 for all rates
    if (rules.reverseCharge) {
      for (const entry of breakdown.values()) {
        entry.amount = 0;
      }
    }

    const totalHT = this.round(
      [...breakdown.values()].reduce((sum, e) => sum + e.base, 0),
    );
    const totalVAT = this.round(
      [...breakdown.values()].reduce((sum, e) => sum + e.amount, 0),
    );

    return {
      totalHT,
      totalVAT,
      totalTTC: this.round(totalHT + totalVAT),
      breakdown: [...breakdown.entries()]
        .map(([, data]) => ({
          ...data,
          base: this.round(data.base),
          amount: this.round(data.amount),
        }))
        .sort((a, b) => b.rate - a.rate),
    };
  }

  /**
   * Calculate VAT for a single amount
   */
  calculateVAT(amount: number, rate: number, _roundingMode: 'line' | 'total' = 'total'): number {
    return this.round((amount * rate) / 100);
  }

  /**
   * Calculate price excluding VAT from price including VAT
   */
  calculateHT(amountTTC: number, rate: number): number {
    return this.round(amountTTC / (1 + rate / 100));
  }

  /**
   * Calculate price including VAT from price excluding VAT
   */
  calculateTTC(amountHT: number, rate: number): number {
    return this.round(amountHT * (1 + rate / 100));
  }

  /**
   * Round to 2 decimal places (standard for currency)
   */
  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Validate VAT breakdown totals match invoice totals
   */
  validateBreakdown(
    breakdown: VATBreakdownItem[],
    expectedHT: number,
    expectedVAT: number,
  ): { valid: boolean; htDiff: number; vatDiff: number } {
    const calculatedHT = breakdown.reduce((sum, b) => sum + b.base, 0);
    const calculatedVAT = breakdown.reduce((sum, b) => sum + b.amount, 0);

    const htDiff = this.round(Math.abs(calculatedHT - expectedHT));
    const vatDiff = this.round(Math.abs(calculatedVAT - expectedVAT));

    // Allow 0.01 tolerance for rounding differences
    return {
      valid: htDiff <= 0.01 && vatDiff <= 0.01,
      htDiff,
      vatDiff,
    };
  }
}

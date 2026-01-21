import { Injectable } from '@nestjs/common';
import { VATRate } from '../interfaces';

export interface VATCalculationInput {
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export interface VATCalculationResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  breakdown: Array<{
    rate: number;
    code: string;
    base: number;
    amount: number;
  }>;
}

export interface VATRules {
  rates: VATRate[];
  defaultRate: number;
  reverseCharge: boolean;
}

@Injectable()
export class VATEngineService {
  calculate(items: VATCalculationInput[], rules: VATRules): VATCalculationResult {
    const breakdown = new Map<number, { code: string; base: number; amount: number }>();

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const rate = item.vatRate;

      if (!breakdown.has(rate)) {
        const rateInfo = rules.rates.find((r) => r.rate === rate);
        breakdown.set(rate, { code: rateInfo?.code || 'S', base: 0, amount: 0 });
      }

      const entry = breakdown.get(rate)!;
      entry.base += lineTotal;
    }

    // Calculate VAT amounts
    for (const [rate, entry] of breakdown.entries()) {
      entry.amount = rules.reverseCharge ? 0 : Math.round(entry.base * rate) / 100;
    }

    const totalHT = [...breakdown.values()].reduce((sum, e) => sum + e.base, 0);
    const totalVAT = [...breakdown.values()].reduce((sum, e) => sum + e.amount, 0);

    return {
      totalHT: Math.round(totalHT * 100) / 100,
      totalVAT: Math.round(totalVAT * 100) / 100,
      totalTTC: Math.round((totalHT + totalVAT) * 100) / 100,
      breakdown: [...breakdown.entries()].map(([rate, data]) => ({ rate, ...data })),
    };
  }
}

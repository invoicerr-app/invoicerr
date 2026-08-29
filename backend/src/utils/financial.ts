/**
 * Décimales par devise (ISO 4217). Vivait dans le moteur de conformité, supprimé — mais ce n'est
 * pas une règle fiscale : c'est la subdivision de la monnaie. Le yen n'a pas de centimes, le dinar
 * koweïtien en a mille. Tout le reste vaut 2.
 */
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

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** decimalsFor(currency));
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency);
}

export type FinancialLineItem = {
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
};

export interface DiscountCalculationOptions {
  isVatExempt?: boolean;
}

export interface DiscountTotals {
  discountRate: number;
  discountFactor: number;
  baseTotalHT: number;
  discountAmountHT: number;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
}

export function clampDiscountRate(rate?: number | null): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return 0;
  }
  return Math.min(Math.max(rate, 0), 100);
}

export function calculateDiscountedTotals(
  items: FinancialLineItem[],
  discountRate: number,
  { isVatExempt = false }: DiscountCalculationOptions = {},
): DiscountTotals {
  const normalizedRate = clampDiscountRate(discountRate);
  const discountFactor = 1 - normalizedRate / 100;

  const baseTotalHT = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const totalHT = baseTotalHT * discountFactor;
  const discountAmountHT = baseTotalHT - totalHT;

  const totalVAT = isVatExempt
    ? 0
    : items.reduce((sum, item) => {
        const vatRate = (item.vatRate || 0) / 100;
        const discountedBase = item.quantity * item.unitPrice * discountFactor;
        return sum + discountedBase * vatRate;
      }, 0);

  const totalTTC = totalHT + totalVAT;

  return {
    discountRate: normalizedRate,
    discountFactor,
    baseTotalHT,
    discountAmountHT,
    totalHT,
    totalVAT,
    totalTTC,
  };
}

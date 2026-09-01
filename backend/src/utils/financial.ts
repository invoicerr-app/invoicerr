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

/**
 * VAT including/excluding UI and PDF columns are shown only when a real rate
 * applies (any line vatRate > 0 or a non-zero VAT total). 0% and VAT-exempt
 * documents (e.g. USA, FR 293 B CGI) display a single Total instead.
 */
export function isVatApplicable(
    totalVAT?: number | null,
    items?: Array<{ vatRate?: number | null }> | null,
): boolean {
    if ((Number(totalVAT) || 0) > 0) {
        return true;
    }
    return (items ?? []).some((item) => (Number(item.vatRate) || 0) > 0);
}

export function getVatDisplayContext(
    totalVAT?: number | null,
    items?: Array<{ vatRate?: number | null }> | null,
): { showVat: boolean; totalsColspan: number } {
    const showVat = isVatApplicable(totalVAT, items);
    return { showVat, totalsColspan: showVat ? 5 : 4 };
}

export function calculateDiscountedTotals(
    items: FinancialLineItem[],
    discountRate: number,
    { isVatExempt = false }: DiscountCalculationOptions = {}
): DiscountTotals {
    const normalizedRate = clampDiscountRate(discountRate);
    const discountFactor = 1 - normalizedRate / 100;

    const baseTotalHT = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
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

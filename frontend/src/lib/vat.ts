/**
 * Show including/excluding VAT only when a real rate applies.
 * 0% and VAT-not-applicable documents (e.g. USA) use a single Total.
 */
export function isVatApplicable(
    totalVAT?: number | null,
    items?: Array<{ vatRate?: number | null }> | null,
): boolean {
    if ((Number(totalVAT) || 0) > 0) {
        return true
    }
    return (items ?? []).some((item) => (Number(item.vatRate) || 0) > 0)
}

/**
 * Shared formatting/aggregation helpers for the national skeleton builders.
 *
 * These are the deduplicated one-liners that were re-implemented identically in
 * every regional builder (they were written by independent scaffolding passes).
 * Semantics are byte-identical to the original inline expressions:
 *
 *   sumNet(items)           ≡ items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
 *   sumVat(items, d)        ≡ items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || d) / 100, 0)
 *   isoDate(data)           ≡ (data.issuedAt ?? data.createdAt).toISOString().split('T')[0]
 *   isoDateTimeSeconds(data)≡ (data.issuedAt ?? data.createdAt).toISOString().split('.')[0]
 *
 * NOT unified here (subtly different semantics — kept inline in their builders):
 *   - GT FEL date: toISOString().replace('.000', '') — keeps millis+Z unless exactly .000
 *   - VN TT78 date: full toISOString() with milliseconds
 *   - FatturaPA fmtAmount/fmtRate, Facturae esc/toAlpha3 — format-specific, single use
 */
import type { InvoiceRenderData } from '../render-data';

type RenderItems = InvoiceRenderData['items'];
type RenderDates = Pick<InvoiceRenderData, 'issuedAt' | 'createdAt'>;

/** Net total: Σ quantity × unitPrice (no VAT). */
export function sumNet(items: RenderItems): number {
    return items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
}

/** VAT total: Σ quantity × unitPrice × (vatRate || defaultRate) / 100. */
export function sumVat(items: RenderItems, defaultRate = 0): number {
    return items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || defaultRate) / 100, 0);
}

/** Issue date as YYYY-MM-DD (issuedAt, falling back to createdAt). */
export function isoDate(data: RenderDates): string {
    return (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
}

/** Issue datetime as YYYY-MM-DDTHH:mm:ss (no milliseconds, no zone suffix). */
export function isoDateTimeSeconds(data: RenderDates): string {
    return (data.issuedAt ?? data.createdAt).toISOString().split('.')[0];
}

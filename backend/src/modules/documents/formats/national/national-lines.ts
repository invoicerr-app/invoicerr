/**
 * Shared line-extraction for NATIONAL (non-EN16931) format providers — `fa3-provider.ts` (PL) and
 * `fatturapa-provider.ts` (IT). Same split `../shared-build.ts#extractLines`
 * already draws for CII/UBL: the DESCRIPTIVE facts (description/quantity/unit) come straight off the
 * invoice descriptor's own raw `lines` field, while the ARITHMETIC facts (net/VAT/gross, discount
 * already applied) come from `totals/compute-totals.ts` — NEVER recomputed here. Centralized in one
 * file rather than duplicated in each national provider, the same way `shared-build.ts` centralizes
 * it once for CII+UBL+Factur-X.
 *
 * Zipping by INDEX is safe for the same reason `shared-build.ts`'s own header gives: the invoice
 * descriptor declares exactly one qualifying line-array field, so `data.lines[i]` and
 * `totals.lines[i]` are the same row, in the same order.
 */
import { DocumentTotals } from '../../totals/compute-totals';

export interface NationalLine {
  index: number;
  description: string;
  quantity: number;
  unit: string;
  /** BT-146-equivalent — the RAW unit price the user typed (major currency units), never derived
   *  from `netMinor / quantity` (that would silently reintroduce the rounding `compute-totals.ts`
   *  already resolved once, the exact mistake this module exists to avoid). */
  unitPrice: number;
  /** Discounted net, in MINOR units — `compute-totals.ts`'s own output, never recalculated. */
  netMinor: number;
  vatRatePercent: number | null;
  /** The RAW, as-stored `vatRate` field value for this line — the catalog `id`
   *  (`vat-rates/registry.ts#vatRateFieldOptions`'s own header, e.g. "it-esente") a fresh document
   *  now carries, or the bare legacy percentage string an older one still does. `vatRatePercent`
   *  above is already the resolved NUMBER either way; this is kept alongside it, verbatim and
   *  unresolved, for a national provider that needs to know WHICH catalog entry was actually picked
   *  — not merely its percentage — because two entries can share one (`fatturapa-provider.ts
   *  #mapNatura`, Italy's `it-esente` vs. `it-non-imponibile`, both 0%). `undefined` for a row with
   *  no usable value at all, same condition `vatRatePercent` itself being `null` already covers. */
  rawVatRate: string | undefined;
  vatMinor: number;
  grossMinor: number;
}

export function extractNationalLines(data: Record<string, unknown>, totals: DocumentTotals): NationalLine[] {
  const rows = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  return totals.lines.map((lineTotal, i) => {
    const row = rows[i] ?? {};
    return {
      index: lineTotal.index,
      description: typeof row.description === 'string' ? row.description : '',
      quantity: typeof row.quantity === 'number' ? row.quantity : 0,
      unit: typeof row.unit === 'string' ? row.unit : '',
      unitPrice: typeof row.unitPrice === 'number' ? row.unitPrice : 0,
      netMinor: lineTotal.netMinor,
      vatRatePercent: lineTotal.vatRatePercent,
      rawVatRate: typeof row.vatRate === 'string' ? row.vatRate : undefined,
      vatMinor: lineTotal.vatMinor,
      grossMinor: lineTotal.grossMinor,
    };
  });
}

/**
 * Purchase orders & goods receipts, second pass (three-way match / rapprochement à 3 voies) — the
 * WIRING layer: turns one received invoice, the purchase
 * order it references, and every RECORDED goods receipt against that same purchase order into
 * `three-way-match.ts`'s own plain input shape, runs the pure engine, then layers this company's own
 * stored acceptance (`variance-acceptance.ts`) on top — the exact same three-step shape
 * `tax/resolve-invoice-tax.ts` already holds for a different concern ("compose the plain data, call
 * the pure engine, thread the one stateful fact — there, a hard block; here, an acceptance — through
 * afterward").
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { findOwnedDocument, listDocuments } from '../persistence';
import { getReconciliationSettings } from './reconciliation-settings';
import {
  computeThreeWayMatch,
  GoodsReceiptLineInput,
  LineMatchVerdict,
  PurchaseOrderLineInput,
  ReceivedInvoiceLineInput,
  ThreeWayMatchLine,
} from './three-way-match';
import { getVarianceAcceptance, VarianceAcceptance } from './variance-acceptance';

/** How many of this company's own goods receipts are scanned for ones referencing the purchase order
 *  under reconciliation — a bounded, honest linear check, the same `500`-row budget
 *  `received-invoices.service.ts`'s own `DUPLICATE_CHECK_LIMIT` already uses for an identical
 *  per-request, not-a-hot-path scan. */
const GOODS_RECEIPT_SCAN_LIMIT = 500;

/** The final, screen-facing verdict — the engine's own two-value `LineMatchVerdict` widened with the
 *  THIRD state a human decision (never the pure engine) can reach: `'accepted'`. */
export type FinalVerdict = LineMatchVerdict | 'accepted';

export interface ReconciliationLineView extends Omit<ThreeWayMatchLine, 'verdict'> {
  verdict: FinalVerdict;
}

export type ReceivedInvoiceReconciliationResult =
  | { hasPurchaseOrder: false }
  | {
      hasPurchaseOrder: true;
      purchaseOrderId: string;
      tolerancePercent: number;
      overallVerdict: FinalVerdict;
      lines: ReconciliationLineView[];
      /** Null when nobody has accepted the variance (yet) — the routine state for a fresh
       *  `to-review` line. Present once an OWNER/ADMIN has (`accept-variance`). */
      acceptance: VarianceAcceptance | null;
    };

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractRows(data: unknown): Record<string, unknown>[] {
  const lines = (data as Record<string, unknown> | null)?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/** `purchase-order.descriptor.ts`'s own `lines` shape: `description`/`quantity`/`unitPrice`. Rows with
 *  no usable description are skipped — an unmatchable blank row has nothing for the engine to key on,
 *  the same "skip, never crash" posture `types.ts`'s own `listItem` resolution already documents for a
 *  descriptor/data mismatch. */
function extractPurchaseOrderLines(data: unknown): PurchaseOrderLineInput[] {
  return extractRows(data)
    .map((row) => ({
      description: toText(row.description).trim(),
      quantity: toFiniteNumber(row.quantity),
      unitPrice: toFiniteNumber(row.unitPrice),
    }))
    .filter((line) => line.description.length > 0);
}

/** `goods-receipt.descriptor.ts`'s own `lines` shape: `description`/`quantityReceived`. */
function extractGoodsReceiptLines(data: unknown): GoodsReceiptLineInput[] {
  return extractRows(data)
    .map((row) => ({
      description: toText(row.description).trim(),
      quantityReceived: toFiniteNumber(row.quantityReceived),
    }))
    .filter((line) => line.description.length > 0);
}

/** `received-invoice.descriptor.ts`'s own `lines` shape: `description`/`quantity`/`unitPrice` (excl.
 *  VAT) — the exact three fields the engine needs; `vatRate` plays no part in a 3-way match. */
function extractReceivedInvoiceLines(data: unknown): ReceivedInvoiceLineInput[] {
  return extractRows(data)
    .map((row) => ({
      description: toText(row.description).trim(),
      quantity: toFiniteNumber(row.quantity),
      unitPrice: toFiniteNumber(row.unitPrice),
    }))
    .filter((line) => line.description.length > 0);
}

function applyAcceptance(verdict: LineMatchVerdict, accepted: boolean): FinalVerdict {
  return accepted && verdict === 'to-review' ? 'accepted' : verdict;
}

/**
 * Resolves the FULL reconciliation for one received invoice — `hasPurchaseOrder: false` (never a
 * 4xx) for the routine case where this received invoice carries no `purchaseOrder` reference at all
 * (see `received-invoice.descriptor.ts`'s own new field): most received invoices have nothing to
 * reconcile, which is a normal, expected state for this screen to show plainly, not an error.
 *
 * A `purchaseOrder` reference that no longer resolves (the PO was deleted, or the reference was typed
 * against a foreign company) is left to `findOwnedDocument`'s own 404 — a dangling reference is a real
 * data problem, and this composition surfaces it loudly rather than silently degrading to
 * `hasPurchaseOrder: false`, the same "must block, never silently drop" posture
 * `row-selection/row-selection.ts`'s own header documents for the identical class of failure.
 *
 * Only RECORDED goods receipts are counted — a `draft` one is still being entered by the warehouse and
 * is not yet a fact this company can stand behind, the same "a number is taken only once a status is
 * truly reached" discipline every numbered type in this core already holds.
 */
export async function resolveReceivedInvoiceReconciliation(
  companyId: string,
  receivedInvoiceId: string,
): Promise<ReceivedInvoiceReconciliationResult> {
  const invoice: DocumentInstanceResult = await findOwnedDocument(
    companyId,
    'received-invoice',
    receivedInvoiceId,
  );
  const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
  const purchaseOrderId =
    typeof invoiceData.purchaseOrder === 'string' ? invoiceData.purchaseOrder : undefined;

  if (!purchaseOrderId) {
    return { hasPurchaseOrder: false };
  }

  const [purchaseOrder, receipts, settings] = await Promise.all([
    findOwnedDocument(companyId, 'purchase-order', purchaseOrderId),
    listDocuments(companyId, 'goods-receipt', GOODS_RECEIPT_SCAN_LIMIT),
    getReconciliationSettings(companyId),
  ]);

  const matchingReceipts = receipts.filter((receipt) => {
    const data = (receipt.data ?? {}) as Record<string, unknown>;
    return receipt.status === 'recorded' && data.purchaseOrder === purchaseOrderId;
  });

  const engineResult = computeThreeWayMatch({
    purchaseOrderLines: extractPurchaseOrderLines(purchaseOrder.data),
    receiptLineSets: matchingReceipts.map((receipt) => extractGoodsReceiptLines(receipt.data)),
    invoiceLines: extractReceivedInvoiceLines(invoiceData),
    tolerancePercent: settings.tolerancePercent,
  });

  const acceptance = getVarianceAcceptance(invoiceData);
  const accepted = acceptance !== null;

  return {
    hasPurchaseOrder: true,
    purchaseOrderId,
    tolerancePercent: settings.tolerancePercent,
    overallVerdict: applyAcceptance(engineResult.overallVerdict, accepted),
    lines: engineResult.lines.map((line) => ({ ...line, verdict: applyAcceptance(line.verdict, accepted) })),
    acceptance,
  };
}

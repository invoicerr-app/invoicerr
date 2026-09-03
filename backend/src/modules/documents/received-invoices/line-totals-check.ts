/**
 * TODO_PRODUIT.md T5(a) — "le total contrôle la somme des lignes": a received invoice is the ONE
 * document type in this core that carries BOTH a declarative line array (`data.lines`, added
 * alongside this file — see `received-invoice.descriptor.ts`'s own header) AND three separately
 * stated FLAT totals (`data.netAmount`/`vatAmount`/`grossAmount`) that are never derived from those
 * lines — every OTHER type (invoice/quote/credit-note) has its totals come FROM its lines and
 * nowhere else, so there is nothing to cross-check there. This function is that cross-check, and
 * lives here (received-invoices/, not totals/compute-totals.ts) precisely because it is a fact about
 * THIS type's own two-sources-of-truth shape, not a generic document concern.
 *
 * ## What this is not
 *
 * This NEVER rewrites `netAmount`/`vatAmount`/`grossAmount` from the lines, and never blocks the
 * "receive" action — see `received-invoice.descriptor.ts`'s own header: a received invoice records
 * the SUPPLIER's own document, discrepancies and all. A mismatch is surfaced as a NAMED warning
 * (never a silent drop, never a generic "something's off"), the caller (`received-invoice-actions.ts`)
 * persists it onto `data.lineTotalWarnings` — a reserved, undeclared key, exactly the same convention
 * `fileRef`/`fileName`/`fileMime` already use (see the descriptor's own header) — so it is carried BY
 * the document on every subsequent read, not merely shown once at save time.
 *
 * ## Reuse, not a second line-summing engine
 *
 * The "sum of lines" side is `totals/compute-totals.ts`, called UNCHANGED — the received invoice's
 * own `lines` field was deliberately shaped (`unitPrice` × `quantity`, a 'select' `vatRate`) to be
 * exactly what that generic engine already knows how to total, the same way `invoice.descriptor.ts`'s
 * own lines are (see that field's own comment for why this is not the line's own net/gross amount
 * read directly). No new arithmetic is written here beyond a MINOR-unit comparison with a tolerance.
 *
 * ## Rounding tolerance — decided, not measured
 *
 * Each line's own net (`compute-totals.ts`'s `Math.round(unitPriceMinor * quantity)`) is independently
 * rounded to the nearest minor unit (cent); a total arrived at some OTHER way (the supplier's own
 * software, or a human typing what the printed total says) can therefore differ from the SUM of those
 * independently-rounded lines by up to half a minor unit PER LINE in the worst case. The tolerance
 * below is `max(1, line count)` minor units — one cent of grace per line, floored at one cent even for
 * a single-line document — a deliberately GENEROUS, documented choice (no real received-invoice corpus
 * exists yet to calibrate against): over-forgiving a genuine one-or-two-cent rounding artifact is a far
 * safer default than flagging one as a named discrepancy on someone else's document.
 */
import { fromMinor, toMinor } from '@/utils/financial';

import { buildReceivedInvoiceDescriptor } from '../descriptors/received-invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';

const RECEIVED_INVOICE_DESCRIPTOR = buildReceivedInvoiceDescriptor();

/** See this file's own header, "Rounding tolerance". */
function toleranceMinor(lineCount: number): number {
  return Math.max(1, lineCount);
}

function fmt(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(2)} ${currency}`;
}

interface StatedTotal {
  key: 'netAmount' | 'vatAmount' | 'grossAmount';
  label: string;
  computedMinor: number;
}

/**
 * Compares `data.lines`' own sum (via `computeDocumentTotals`) against `data.netAmount`/`vatAmount`/
 * `grossAmount`, whichever of the three are actually numbers. Returns `[]` (never a mismatch) when
 * `data.lines` has NO rows at all — see `received-invoice.descriptor.ts`'s own header: a document
 * with no readable lines has nothing for a total to be controlled against, and must stay exactly as
 * silent as before this check existed.
 */
export function checkReceivedInvoiceLineTotals(data: Record<string, unknown>): string[] {
  const totals = computeDocumentTotals(RECEIVED_INVOICE_DESCRIPTOR, data);
  if (totals.lines.length === 0) return [];

  const currency = totals.currency ?? 'EUR';
  const tolerance = toleranceMinor(totals.lines.length);
  const warnings: string[] = [];

  const statedTotals: StatedTotal[] = [
    { key: 'netAmount', label: 'net / HT', computedMinor: totals.netMinor },
    { key: 'vatAmount', label: 'VAT', computedMinor: totals.vatMinor },
    { key: 'grossAmount', label: 'gross / TTC', computedMinor: totals.grossMinor },
  ];

  for (const { key, label, computedMinor } of statedTotals) {
    const stated = data[key];
    if (typeof stated !== 'number') continue; // nothing typed/extracted for this total — nothing to compare

    const statedMinor = toMinor(stated, currency);
    const deltaMinor = Math.abs(statedMinor - computedMinor);
    if (deltaMinor <= tolerance) continue;

    warnings.push(
      `Line total mismatch (${label}): the ${totals.lines.length} line(s) sum to ${fmt(computedMinor, currency)} ` +
        `but the document states ${fmt(statedMinor, currency)} — a difference of ${fmt(deltaMinor, currency)}, ` +
        `beyond the ${fmt(tolerance, currency)} rounding tolerance for this many line(s). Kept as entered — ` +
        'this is the supplier’s own document, not recomputed.',
    );
  }

  return warnings;
}

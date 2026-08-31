import { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';
import { toMinor, decimalsFor, fromMinor } from '@/utils/financial';

export interface LineTotal {
  index: number;
  netMinor: number;
  vatRatePercent: number | null;
  vatMinor: number;
  grossMinor: number;
}

export interface VatBreakdownEntry {
  ratePercent: number;
  baseMinor: number;
  vatMinor: number;
}

export interface DocumentTotals {
  currency: string | null;
  lines: LineTotal[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  vatBreakdown: VatBreakdownEntry[];
  warnings: string[];
}

/**
 * Pure function: computes document totals (net, VAT, gross) from a descriptor and instance data.
 *
 * ## Arithmetic
 * - All amounts are in MINOR units (e.g., cents) to avoid floating-point rounding errors.
 * - Line net = round(toMinor(unitPrice, currency) * quantity * (1 - discountPercent / 100))
 * - The discount is applied to the net BEFORE VAT: the DISCOUNTED net is what VAT is computed on,
 *   never the sticker price. This is universal invoicing arithmetic (a discounted sale is taxed on
 *   what was actually charged, not on a price nobody paid) — not a rule any one country's tax code
 *   invents, so it needs no `country-policy`/`vat-rates` citation the way a RATE's own value does.
 *   `discountPercent` is optional and, when present, already constrained to [0, 100] by the 'number'
 *   kind's own `min`/`max` (field-kinds.ts) — absent or 0 leaves the line exactly as it was before
 *   this field existed; 100 makes the line free (netMinor 0) but the formula can never go negative
 *   for a value inside that range, so no separate clamp is needed here.
 * - VAT is computed PER RATE on the AGGREGATED, ALREADY-DISCOUNTED BASE, not per line (e.g., sum all
 *   discounted nets with 20% rate, then round VAT once, not per line). This matches invoice practice:
 *   the invoice itself shows the VAT total per rate, not per line.
 * - Individual LineTotal.vatMinor is indicative (rounded per line for display), but the official
 *   VAT sum comes from VatBreakdownEntry, which is aggregated.
 *
 * ## Field detection (generic, not hardcoded)
 * - Finds every `kind: 'array'` field in the descriptor whose subfields contain AT LEAST one
 *   'money' AND one 'number' field (not just one or the other) — the QUANTITY 'number' field is
 *   whichever one's key does NOT contain "discount" (case-insensitive), the same substring
 *   convention `extractVatRate` below already uses to spot the VAT-rate 'select' field. A line's
 *   own discount, if declared, is likewise a 'number' subfield whose key DOES contain "discount".
 * - If multiple such array fields exist, all are summed together.
 *
 * ## VAT rate extraction
 * - The VAT rate comes from a subfield of kind 'select' whose key contains 'vat' (case-insensitive)
 *   OR whose options resemble numbers (first option's value is numeric or percentage-like).
 * - Missing or non-numeric rate → counted in net only, with a warning: `line <index> has no usable VAT rate — counted in net only`.
 * - A line without a usable rate contributes to netMinor but NOT to any vatBreakdown entry.
 *
 * ## Currency detection
 * - Top-level document field (kind 'select' or 'text') whose key contains 'currency' (case-insensitive).
 * - Missing or not found → currency: null, warning, amounts calculated with default 2 decimals anyway.
 *
 * ## Quantity fallback
 * - If no 'number' subfield exists (shouldn't happen given detection logic), quantity defaults to 1.
 * - If quantity is absent on a row, quantity defaults to 1.
 */
export function computeDocumentTotals(
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
): DocumentTotals {
  const warnings: string[] = [];
  const lines: LineTotal[] = [];

  // === Find currency at document level ===
  let currency: string | null = null;
  for (const field of descriptor.fields) {
    if ((field.kind === 'select' || field.kind === 'text') && field.key.toLowerCase().includes('currency')) {
      const value = data[field.key];
      if (typeof value === 'string' && value) {
        currency = value;
        break;
      }
    }
  }

  if (!currency) {
    warnings.push('Document currency not found — using default (2 decimals).');
  }

  // === Find array fields with both 'money' and 'number' subfields ===
  const arrayFields = findLineArrayFields(descriptor);

  if (arrayFields.length === 0) {
    // No line fields found — return zero totals
    return {
      currency,
      lines: [],
      netMinor: 0,
      vatMinor: 0,
      grossMinor: 0,
      vatBreakdown: [],
      warnings,
    };
  }

  // === Process each array field ===
  const allLinesProcessed: Array<{
    index: number;
    netMinor: number;
    vatRatePercent: number | null;
  }> = [];
  let globalLineNumber = 1; // For warning messages (1-indexed)

  for (const arrayField of arrayFields) {
    const arrayValue = data[arrayField.key];
    const rows = Array.isArray(arrayValue) ? (arrayValue as Record<string, unknown>[]) : [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];

      // Find money and number subfields — the QUANTITY 'number' field is the one whose key does NOT
      // look like a discount (see this file's own header); a descriptor with only one 'number'
      // subfield (no discount declared at all) is unaffected, since that field never matches
      // "discount" either.
      const moneyField = arrayField.fields?.find((f) => f.kind === 'money');
      const numberField = arrayField.fields?.find(
        (f) => f.kind === 'number' && !f.key.toLowerCase().includes('discount'),
      );
      const discountField = arrayField.fields?.find(
        (f) => f.kind === 'number' && f.key.toLowerCase().includes('discount'),
      );

      if (!moneyField) continue; // Shouldn't happen given detection, but be defensive

      // Extract quantity (default 1)
      let quantity = 1;
      if (numberField) {
        const qtyValue = row[numberField.key];
        if (typeof qtyValue === 'number') {
          quantity = qtyValue;
        }
      }

      // Extract unit price
      let unitPriceMinor = 0;
      const priceValue = row[moneyField.key];
      if (typeof priceValue === 'number') {
        unitPriceMinor = toMinor(priceValue, currency || 'EUR');
      }

      // Extract the line's own discount (default 0 — no discount, the line as it always was).
      let discountPercent = 0;
      if (discountField) {
        const discountValue = row[discountField.key];
        if (typeof discountValue === 'number' && Number.isFinite(discountValue)) {
          discountPercent = discountValue;
        }
      }

      // Calculate net for this line — the discount is applied HERE, before VAT ever sees this
      // number: see this file's own header on why that ordering is universal arithmetic, not a
      // national rule, and why no separate clamp is needed for a `discountPercent` already in [0,100].
      const netMinor = Math.round(unitPriceMinor * quantity * (1 - discountPercent / 100));

      // Find VAT rate
      const vatRatePercent = extractVatRate(arrayField, row, rowIndex, globalLineNumber, warnings);

      allLinesProcessed.push({ index: allLinesProcessed.length, netMinor, vatRatePercent });
      globalLineNumber++;
    }
  }

  // === Build LineTotal entries and accumulate by VAT rate ===
  const rateToBase: Record<string, number> = {}; // "rate_percent" -> baseMinor
  const rateToLineTotals: Record<string, { vatMinor: number; grossMinor: number }> = {};

  for (const { index, netMinor, vatRatePercent } of allLinesProcessed) {
    const lineVatMinor = vatRatePercent !== null ? Math.round((netMinor * vatRatePercent) / 100) : 0;
    const lineGrossMinor = netMinor + lineVatMinor;

    lines.push({
      index,
      netMinor,
      vatRatePercent,
      vatMinor: lineVatMinor,
      grossMinor: lineGrossMinor,
    });

    // Accumulate base by rate
    const rateKey = vatRatePercent !== null ? String(vatRatePercent) : 'null';
    if (vatRatePercent !== null) {
      rateToBase[rateKey] = (rateToBase[rateKey] ?? 0) + netMinor;
    }
  }

  // === Compute VAT breakdown (by AGGREGATED base per rate) ===
  const vatBreakdown: VatBreakdownEntry[] = [];
  let totalNetMinor = 0;
  let totalVatMinor = 0;

  // First, compute VAT for each rate on the aggregated base
  for (const rateStr of Object.keys(rateToBase).sort((a, b) => Number(a) - Number(b))) {
    const ratePercent = Number(rateStr);
    const baseMinor = rateToBase[rateStr];
    const vatMinor = Math.round((baseMinor * ratePercent) / 100);

    vatBreakdown.push({ ratePercent, baseMinor, vatMinor });
    totalNetMinor += baseMinor;
    totalVatMinor += vatMinor;
  }

  // Lines with null rate (no VAT) contribute to net but not to breakdown
  for (const line of lines) {
    if (line.vatRatePercent === null) {
      totalNetMinor += line.netMinor;
    }
  }

  const totalGrossMinor = totalNetMinor + totalVatMinor;

  return {
    currency,
    lines,
    netMinor: totalNetMinor,
    vatMinor: totalVatMinor,
    grossMinor: totalGrossMinor,
    vatBreakdown,
    warnings,
  };
}

/**
 * Find all array fields that have BOTH a 'money' and a 'number' subfield.
 * These are the fields we consider "line" fields.
 */
function findLineArrayFields(descriptor: DocumentTypeDescriptor): DocumentFieldDescriptor[] {
  const result: DocumentFieldDescriptor[] = [];

  for (const field of descriptor.fields) {
    if (field.kind !== 'array' || !field.fields) continue;

    const hasMoney = field.fields.some((f) => f.kind === 'money');
    const hasNumber = field.fields.some((f) => f.kind === 'number');

    if (hasMoney && hasNumber) {
      result.push(field);
    }
  }

  return result;
}

/**
 * Extract VAT rate from a row's subfields.
 * Looks for a 'select' field whose key contains 'vat' (case-insensitive),
 * or whose options look numeric (first option's value is numeric/percentage-like).
 * Returns the rate as a number, or null if not found or not parseable.
 */
function extractVatRate(
  arrayField: DocumentFieldDescriptor,
  row: Record<string, unknown>,
  rowIndex: number,
  lineNumber: number,
  warnings: string[],
): number | null {
  if (!arrayField.fields) return null;

  for (const subField of arrayField.fields) {
    if (subField.kind !== 'select') continue;

    const isVatField =
      subField.key.toLowerCase().includes('vat') ||
      (subField.options && subField.options.length > 0 && looksNumeric(subField.options[0].value));

    if (!isVatField) continue;

    const value = row[subField.key];
    if (value === undefined || value === null || value === '') {
      warnings.push(`line ${lineNumber} has no usable VAT rate — counted in net only`);
      return null;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      warnings.push(`line ${lineNumber} has no usable VAT rate — counted in net only`);
      return null;
    }

    return parsed;
  }

  // No select field found with VAT-like characteristics
  warnings.push(`line ${lineNumber} has no usable VAT rate — counted in net only`);
  return null;
}

/**
 * Whether a string looks like a number (for rate detection).
 * "20", "5.5", "0" all return true; "standard" returns false.
 */
function looksNumeric(value: string): boolean {
  const parsed = Number(value);
  return !Number.isNaN(parsed);
}

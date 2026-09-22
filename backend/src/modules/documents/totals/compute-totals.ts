import { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';
import { toMinor, decimalsFor, fromMinor } from '@/utils/financial';
import { defaultVatRateCatalog, findVatRateById } from '../vat-rates/registry';

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
  /**
   * Whether the VAT breakdown is worth printing at all — a display flag, never an input to the
   * arithmetic above (net/vat/gross stay exactly what the lines say either way). False when either:
   *  - the seller itself has no VAT to charge at all (`ComputeTotalsOptions.sellerExemptVat`, the
   *    small-business exemption a company ticks in Settings — `Company.exemptVat`), regardless of
   *    what a not-yet-resolved line's own rate still says (a franchise-base seller's DRAFT can still
   *    carry a stray non-zero rate until "send" rewrites every line to 0% —
   *    `tax/resolve-invoice-tax.ts#applyDomesticTaxScheme` — this flag must not wait for that to
   *    happen before hiding a line nobody will ever actually charge); or
   *  - every line that DOES carry a rate resolved to exactly 0% (an all-exempt/all-reverse-charge
   *    document — autoliquidation, an export, an intra-Community supply) — there is no VAT amount on
   *    this document at all, so a "VAT 0% on X — 0.00" row would say nothing a reader doesn't already
   *    read off the gross total.
   * True the moment ANY rate in the breakdown is positive — a MIXED document (e.g. one exported line
   * at 0% next to a domestic line at 20%) still needs its breakdown, 0% row included, so the total
   * doesn't look miscounted.
   *
   * Deliberately does NOT touch `mentions/`/`__crossBorderMentions` — a country-mandated notice (the
   * franchise-base "art. 293 B" wording, an autoliquidation mention) is resolved and printed entirely
   * independently of this flag (`rendering/render-instance-pdf.ts#legalMentionsFor`) and must keep
   * printing when this flag goes false: hiding a redundant AMOUNT is not the same as hiding the LEGAL
   * FACT that produced it.
   *
   * Optional so every pre-existing literal built as a `DocumentTotals` fixture (this module's own
   * specs, `render-html.spec.ts`, `render-instance-pdf.spec.ts`, `company/branding/
   * sample-preview-document.ts`) keeps compiling and behaving exactly as before this field existed —
   * `render-html.ts` treats an absent value as "show", the same as an explicit `true`.
   */
  showVat?: boolean;
}

export interface ComputeTotalsOptions {
  /** `Company.exemptVat` — see `DocumentTotals.showVat`'s own header. Never read for anything but
   *  that one derived flag: a franchise-base seller's stored lines/rates are computed exactly as
   *  typed, the same arithmetic as any other company, so a caller that omits this keeps getting
   *  byte-for-byte the same net/vat/gross numbers it always did. */
  sellerExemptVat?: boolean;
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
  options?: ComputeTotalsOptions,
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
      showVat: false,
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

      // Extract quantity (default 1) — see this file's own header, "Quantity fallback": a row where
      // the field is simply ABSENT (a draft still being typed) stays silent, exactly as before. A
      // value that IS present but is not a usable finite number (a stray string, `NaN`, `Infinity` —
      // `typeof NaN === 'number'` is true, so the old `typeof` check alone let it straight through
      // into the arithmetic below) is a genuine data problem, not a draft in progress, and is warned
      // exactly like a missing/non-numeric VAT rate already is (`extractVatRate` below) rather than
      // silently guessed as 1 with no trace — this function is called directly on ALREADY-PERSISTED
      // data at more than one site (`getSettlement`, `record-payment`, `shared-build.ts`) with nothing
      // re-validating it first.
      let quantity = 1;
      if (numberField) {
        const qtyValue = row[numberField.key];
        if (typeof qtyValue === 'number' && Number.isFinite(qtyValue)) {
          quantity = qtyValue;
        } else if (qtyValue !== undefined && qtyValue !== null && qtyValue !== '') {
          warnings.push(
            `line ${globalLineNumber} has a non-numeric quantity ` +
              `(received ${JSON.stringify(qtyValue)}) — counted as 1`,
          );
        }
      }

      // Extract unit price — same "absent stays silent, present-but-unusable is warned" distinction
      // as quantity just above.
      let unitPriceMinor = 0;
      const priceValue = row[moneyField.key];
      if (typeof priceValue === 'number' && Number.isFinite(priceValue)) {
        unitPriceMinor = toMinor(priceValue, currency || 'EUR');
      } else if (priceValue !== undefined && priceValue !== null && priceValue !== '') {
        warnings.push(
          `line ${globalLineNumber} has a non-numeric unit price ` +
            `(received ${JSON.stringify(priceValue)}) — counted as 0`,
        );
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

  // See `DocumentTotals.showVat`'s own header for the full rule — a display flag only, computed last
  // so it reads off the SAME `vatBreakdown` this function just built, never a second pass over `lines`.
  const showVat = !options?.sellerExemptVat && vatBreakdown.some((entry) => entry.ratePercent > 0);

  return {
    currency,
    lines,
    netMinor: totalNetMinor,
    vatMinor: totalVatMinor,
    grossMinor: totalGrossMinor,
    vatBreakdown,
    warnings,
    showVat,
  };
}

/**
 * Whether `computeDocumentTotals` has any SOURCE of money on this type at all — i.e. whether a
 * non-zero total is even reachable for it. A type with NO line array at all (the expense) always
 * totals zero above, by construction, not because a particular instance happens to be empty. The
 * credit note now DOES declare one (`lines`, credit-note.descriptor.ts's own FREE shape) — but a
 * LINKED credit note's own `lines` is always empty by construction (credit-note-actions.ts's own
 * `assertCreditNoteAmountSourceIsUnambiguous`; its real amount comes from `correctedLines` instead,
 * via settlement/credits.ts's OWN, separate calculation), so this still totals zero for that shape —
 * only a genuinely instance-level fact now, not a type-level one the way it used to be for every
 * credit note.
 *
 * Exported for the email-template VOCABULARY (actions/email-template.ts's
 * `describeDocumentEmailVocabulary`): advertising `{totalGross}` to someone editing a type's email
 * would be advertising a placeholder whose value is permanently "0.00" for such a type. It deliberately
 * does NOT gate `buildEmailTemplateParts`, which still substitutes `totalGross` for every type — an
 * already-stored template that uses it (credit-note's own shipped default does) must keep rendering a
 * number, never start emitting an "unknown placeholder" warning.
 */
export function descriptorHasLineTotals(descriptor: DocumentTypeDescriptor): boolean {
  return findLineArrayFields(descriptor).length > 0;
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
 *
 * Purchase orders & goods receipts ("bons de commande") — the "no VAT-like subfield declared on this
 * line shape AT ALL" case (below) is a STRUCTURAL fact about the document TYPE (e.g.
 * `purchase-order.descriptor.ts`, whose lines carry no rate at all — it is not a tax document), never
 * a per-ROW data problem to warn about. Every type that shipped before purchase orders (quote/invoice/
 * received-invoice) always declares SOME vat-like 'select' subfield on its own line shape, so this
 * distinction was previously unreachable — the purchase order is the first type to exercise it. This
 * is why the check below is done ONCE, before the "missing/non-numeric value" branch that still warns
 * exactly as before for every EXISTING type: a rate that genuinely EXISTS as a concept on this line
 * shape but is unset/unparseable on one particular row is still worth flagging.
 */
function extractVatRate(
  arrayField: DocumentFieldDescriptor,
  row: Record<string, unknown>,
  rowIndex: number,
  lineNumber: number,
  warnings: string[],
): number | null {
  if (!arrayField.fields) return null;

  const vatField = arrayField.fields.find((subField) => {
    if (subField.kind !== 'select') return false;
    return (
      subField.key.toLowerCase().includes('vat') ||
      (!!subField.options && subField.options.length > 0 && looksNumeric(subField.options[0].value))
    );
  });

  // Silently counted in net only — see this function's own header just above.
  if (!vatField) return null;

  const value = row[vatField.key];
  if (value === undefined || value === null || value === '') {
    warnings.push(`line ${lineNumber} has no usable VAT rate — counted in net only`);
    return null;
  }

  // `vat-rates/registry.ts#vatRateFieldOptions` now stores each rate's own stable CATALOG id as the
  // field's value (e.g. "it-esente"), never a bare percentage — the ONLY way to keep two same-
  // percentage regimes (Italy's `it-esente`/`it-non-imponibile`, both 0%) distinguishable at all. This
  // function is called with whatever DESCRIPTOR its own caller happens to hold — many of them
  // (accounting-export, reminders, bank-reconciliation, settlement…) reuse the bare, country-BLIND
  // `INVOICE_DESCRIPTOR` singleton, never the per-company view `descriptors/company-view.ts` builds,
  // so `vatField.options` is frequently EMPTY here regardless of what the live form would show — this
  // cannot rely on `field.options`/`field.legacyOptions` the way `field-kinds.ts`'s own validator
  // does. `findVatRateById` looks the value up directly against the real, shipped catalog instead —
  // country-independent by construction (every id is globally unique), which is exactly what a
  // function with no notion of "which company" needs.
  const catalogRate = findVatRateById(defaultVatRateCatalog, String(value));
  if (catalogRate) return catalogRate.rate;

  // No catalog id matched — a country with no known VAT-rate list at all, a hand-typed
  // `allowCustomValue` rate, or simply a document saved BEFORE the id-based value existed (the bare
  // percentage itself, e.g. "20"). Parsed exactly as this function always has.
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    warnings.push(`line ${lineNumber} has no usable VAT rate — counted in net only`);
    return null;
  }

  return parsed;
}

/**
 * Whether a string looks like a number (for rate detection).
 * "20", "5.5", "0" all return true; "standard" returns false.
 */
function looksNumeric(value: string): boolean {
  const parsed = Number(value);
  return !Number.isNaN(parsed);
}

import type { TFunction } from "i18next"

/**
 * Client-side totals calculation — mirrors backend compute-totals.ts logic.
 * Same arithmetic (minor units, VAT per aggregated base), same structure.
 * Any divergence between this and the backend = totals mismatch on the screen vs PDF.
 */

const CURRENCY_DECIMALS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
}

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency?.toUpperCase()] ?? 2
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** decimalsFor(currency))
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency)
}

/**
 * Whether a string looks like a number (for VAT-rate-field detection) — mirrors the backend's own
 * `compute-totals.ts#looksNumeric` EXACTLY: "20", "5.5", "0" all return true; "standard" returns
 * false. Used (document-totals.tsx) to decide whether an undocumented `select` subfield is a VAT
 * rate at all — a `select` whose options are non-numeric (a "quality" or "category" dropdown) must
 * NOT be mistaken for one, the same distinction the backend already draws when picking which
 * `select` subfield to tax on.
 */
export function looksNumeric(value: string): boolean {
  return !Number.isNaN(Number(value))
}

/** The two option lists a VAT-rate 'select' field descriptor carries — see the backend's
 *  `vat-rates/registry.ts#VatRateOptionsResolution`. Kept as a narrow shape here (not the full field
 *  descriptor type) so this file doesn't need to import the frontend's own descriptor mirror just for
 *  this. */
export interface VatRateFieldOptions {
  /** Each rate's stable catalog id as `value` (e.g. "it-esente") — what a field now stores once a
   *  company's country has a known VAT-rate catalog. */
  options?: { value: string; label: string }[]
  /** The SAME rates, same order/index as `options` — each one's bare PERCENTAGE as `value` instead.
   *  Never rendered as a choice; exists only so a catalog id can be resolved back to its percentage
   *  without this file needing the catalog itself (which is backend-only data). */
  legacyOptions?: { value: string; label: string }[]
}

/**
 * Resolves a stored VAT-rate value to its percentage — mirrors the backend's own
 * `vat-rates/registry.ts#resolveVatRatePercentage` exactly, from what the descriptor already hands
 * this side (no VAT-rate catalog exists on the frontend, so this can only ever work from `options`/
 * `legacyOptions`, never look a rate up independently):
 *  1. `value` is a catalog id (e.g. "it-esente") — find its position in `options`, then read the SAME
 *     position out of `legacyOptions` for the percentage. Both lists come from the exact same rates
 *     array, in the same order (`vatRateFieldOptions` builds them together), so the index always names
 *     the same rate in both.
 *  2. Otherwise, `value` is either the legacy bare-percentage form a document saved before catalog ids
 *     existed still carries, or a hand-typed rate on a field with no catalog at all
 *     (`allowCustomValue`) — parsed directly, exactly as this function always did before catalog ids.
 * `null` when neither applies (an id the active company's catalog no longer lists, or genuinely
 * unparseable text) — the caller warns exactly as it already does for "no usable VAT rate".
 */
export function resolveVatRatePercent(value: string, fieldOptions?: VatRateFieldOptions): number | null {
  const options = fieldOptions?.options ?? []
  const legacyOptions = fieldOptions?.legacyOptions ?? []
  const catalogIndex = options.findIndex((option) => option.value === value)
  if (catalogIndex !== -1) {
    const legacyMatch = legacyOptions[catalogIndex]
    const percent = legacyMatch ? Number(legacyMatch.value) : NaN
    if (!Number.isNaN(percent)) return percent
  }

  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

export interface ClientLineTotal {
  index: number
  netMinor: number
  vatRatePercent: number | null
  vatMinor: number
  grossMinor: number
}

export interface ClientVatBreakdownEntry {
  ratePercent: number
  baseMinor: number
  vatMinor: number
}

export interface ClientDocumentTotals {
  currency: string | null
  lines: ClientLineTotal[]
  netMinor: number
  vatMinor: number
  grossMinor: number
  vatBreakdown: ClientVatBreakdownEntry[]
  warnings: string[]
}

/**
 * Compute totals from form data. Mirrors backend compute-totals.ts EXACTLY — any divergence here is
 * a total shown on screen that disagrees with the PDF/API, which is the one thing this file exists
 * to prevent:
 * - All amounts in minor units
 * - Line net = round(toMinor(unitPrice, currency) * quantity * (1 - discountPercent / 100))
 * - The discount applies BEFORE VAT (the discounted net is the taxable base) — see the backend's own
 *   compute-totals.ts header for why this is universal arithmetic, not a national rule.
 * - VAT computed per rate on the aggregated, already-discounted base, not per line
 * - Currency from top-level field with 'currency' in key
 * - Quantity defaults to 1, discount defaults to 0, VAT rate to null (counted in net only)
 * - A MISSING `vatRateFieldKey` means this line SHAPE has no VAT-like subfield at all (a purchase
 *   order has none: it is not a tax document) — a STRUCTURAL fact about the document TYPE, never a
 *   per-row data problem, so it is silent, exactly like the backend's own `extractVatRate` when
 *   `arrayField.fields` never declares one (compute-totals.ts's own header explains why). Only a
 *   rate that genuinely EXISTS as a concept on this line shape but is unset/unparseable on ONE row
 *   still warns — that case is a real data problem, not a fact about the type.
 */
export function computeTotals(
  lines: Array<Record<string, unknown>>,
  currency: string | null,
  moneyFieldKey: string,
  numberFieldKey: string | undefined,
  vatRateFieldKey: string | undefined,
  discountFieldKey: string | undefined,
  /** Optional so every existing caller that never reads `.warnings` (list-amount.ts's per-row
   *  total, this file's own tests) keeps working unchanged — falls back to the same raw English the
   *  backend emits (this file "mirrors compute-totals.ts EXACTLY", including its warning text) when
   *  omitted. The one caller that actually SHOWS these to a user (`document-totals.tsx`'s
   *  `useDocumentTotals`) passes its own `useTranslation()` result. */
  t?: TFunction,
  /** `vatRateFieldKey`'s own `options`/`legacyOptions` — see `resolveVatRatePercent`'s own header.
   *  Optional so a caller with no VAT-rate field at all (or a plain custom-value one, `options` never
   *  populated) doesn't need to construct an empty shape just to call this. */
  vatRateOptions?: VatRateFieldOptions,
): ClientDocumentTotals {
  const warnings: string[] = []
  const processedLines: Array<{
    index: number
    netMinor: number
    vatRatePercent: number | null
  }> = []

  // Process each line
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]

    // Extract quantity (default 1)
    let quantity = 1
    if (numberFieldKey) {
      const qtyValue = line[numberFieldKey]
      if (typeof qtyValue === "number") {
        quantity = qtyValue
      }
    }

    // Extract unit price and convert to minor
    let unitPriceMinor = 0
    const priceValue = line[moneyFieldKey]
    if (typeof priceValue === "number") {
      unitPriceMinor = toMinor(priceValue, currency || "EUR")
    }

    // Extract the line's own discount (default 0 — no discount, unchanged from before this existed).
    let discountPercent = 0
    if (discountFieldKey) {
      const discountValue = line[discountFieldKey]
      if (typeof discountValue === "number" && Number.isFinite(discountValue)) {
        discountPercent = discountValue
      }
    }

    // Calculate net for this line (in minor units) — discount applied before VAT, same as backend.
    const netMinor = Math.round(unitPriceMinor * quantity * (1 - discountPercent / 100))

    // Extract VAT rate — see this function's own header on the `vatRateFieldKey` branch below:
    // "no VAT-like subfield on this shape at all" (a purchase order) is silent, never a warning.
    let vatRatePercent: number | null = null
    if (vatRateFieldKey) {
      const rateValue = line[vatRateFieldKey]
      const lineNumber = lineIndex + 1
      const noUsableRateWarning =
        t?.("documents.totals.warnings.noUsableVatRate", { line: lineNumber }) ??
        `line ${lineNumber} has no usable VAT rate — counted in net only`
      if (rateValue !== undefined && rateValue !== null && rateValue !== "") {
        const resolved = resolveVatRatePercent(String(rateValue), vatRateOptions)
        if (resolved !== null) {
          vatRatePercent = resolved
        } else {
          warnings.push(noUsableRateWarning)
        }
      } else {
        warnings.push(noUsableRateWarning)
      }
    }

    processedLines.push({ index: lineIndex, netMinor, vatRatePercent })
  }

  // Build line totals and accumulate by VAT rate
  const resultLines: ClientLineTotal[] = []
  const rateToBase: Record<string, number> = {}

  for (const { index, netMinor, vatRatePercent } of processedLines) {
    const lineVatMinor = vatRatePercent !== null ? Math.round((netMinor * vatRatePercent) / 100) : 0
    const lineGrossMinor = netMinor + lineVatMinor

    resultLines.push({
      index,
      netMinor,
      vatRatePercent,
      vatMinor: lineVatMinor,
      grossMinor: lineGrossMinor,
    })

    // Accumulate base by rate (only for lines with VAT)
    if (vatRatePercent !== null) {
      const rateKey = String(vatRatePercent)
      rateToBase[rateKey] = (rateToBase[rateKey] ?? 0) + netMinor
    }
  }

  // Compute VAT breakdown (by aggregated base per rate)
  const vatBreakdown: ClientVatBreakdownEntry[] = []
  let totalNetMinor = 0
  let totalVatMinor = 0

  // VAT per rate (on aggregated base)
  for (const rateStr of Object.keys(rateToBase).sort((a, b) => Number(a) - Number(b))) {
    const ratePercent = Number(rateStr)
    const baseMinor = rateToBase[rateStr]
    const vatMinor = Math.round((baseMinor * ratePercent) / 100)

    vatBreakdown.push({ ratePercent, baseMinor, vatMinor })
    totalNetMinor += baseMinor
    totalVatMinor += vatMinor
  }

  // Lines with null rate (no VAT) contribute to net
  for (const line of resultLines) {
    if (line.vatRatePercent === null) {
      totalNetMinor += line.netMinor
    }
  }

  const totalGrossMinor = totalNetMinor + totalVatMinor

  return {
    currency,
    lines: resultLines,
    netMinor: totalNetMinor,
    vatMinor: totalVatMinor,
    grossMinor: totalGrossMinor,
    vatBreakdown,
    warnings,
  }
}

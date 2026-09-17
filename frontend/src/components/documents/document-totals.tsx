import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import type { DocumentTypeDescriptor } from "@/components/documents/types"
import {
  type ClientDocumentTotals,
  type VatRateFieldOptions,
  computeTotals,
  decimalsFor,
  fromMinor,
  looksNumeric,
} from "@/components/documents/totals-calculator"
import { extractCurrency, findLineArrayFields } from "@/components/documents/totals-shape"
import { useCompany } from "@/hooks/queries"

/**
 * The LIVE totals (net, VAT breakdown, gross) of the document form currently mounted around this
 * hook — mirrors the backend's compute-totals.ts logic exactly, recomputed on every form change.
 * Null when the form has no line rows yet, no money subfield to sum, or sums to nothing. Must be
 * called inside a react-hook-form `<Form>` (it watches the whole form): DocumentTotals below renders
 * it, and the detail page's header reads it once more for the headline amount.
 */
export function useDocumentTotals(descriptor: DocumentTypeDescriptor) {
  const { t } = useTranslation()
  const formValues = useWatch()
  // The active company's own `exemptVat` — see `computeDocumentTotals`'s own `sellerExemptVat` param
  // and `ClientDocumentTotals.showVat`'s header. `data` is undefined while the query is still
  // in flight (or on a company with none set); `sellerExemptVat` then stays undefined too, the exact
  // same "show" default `computeTotals` already holds for every caller that never passes it.
  const { data: company } = useCompany()
  return useMemo(
    () => computeDocumentTotals(descriptor, formValues, t, company?.exemptVat),
    [formValues, descriptor, t, company?.exemptVat],
  )
}

/**
 * The pure half of `useDocumentTotals`: the same net/VAT/gross for ANY `values` object shaped like
 * the document's data — the live form above, or a SAVED record's `instance.data` (the list's own
 * per-row total, list-amount.ts). One function so a row in the list and the page it opens can never
 * disagree on the figure. Null when there are no line rows, no money subfield to sum, or nothing
 * sums to anything.
 */
export function computeDocumentTotals(
  descriptor: DocumentTypeDescriptor,
  values: Record<string, unknown> | undefined,
  /** See `computeTotals`'s own header — optional, only `useDocumentTotals` above (the one path that
   *  actually renders `.warnings` to a user) passes it. */
  t?: TFunction,
  /** `Company.exemptVat` — see `computeTotals`'s own header and `ClientDocumentTotals.showVat`.
   *  Optional so `list-amount.ts`'s per-row total (which never shows a VAT line to begin with, only
   *  the gross figure) doesn't need a company lookup just to call this. */
  sellerExemptVat?: boolean,
): ClientDocumentTotals | null {
  const arrayFields = findLineArrayFields(descriptor)
  if (!values || arrayFields.length === 0) return null

  // Collect all lines from all array fields
  const allLines: Array<Record<string, unknown>> = []
  for (const arrayField of arrayFields) {
    const arrayValue = values[arrayField.key]
    const rows = Array.isArray(arrayValue) ? (arrayValue as Record<string, unknown>[]) : []
    allLines.push(...rows)
  }
  if (allLines.length === 0) return null

  // Use the first array field for field key detection (all should have same structure)
  const firstArrayField = arrayFields[0]
  const moneyField = firstArrayField.fields?.find((f) => f.kind === "money")
  // The QUANTITY field is the 'number' subfield whose key does NOT look like a discount — mirrors
  // the backend's own compute-totals.ts detection exactly, so a descriptor that also declares
  // `discountPercent` (a second 'number' subfield) is not mistaken for the quantity here.
  const numberField = firstArrayField.fields?.find(
    (f) => f.kind === "number" && !f.key.toLowerCase().includes("discount"),
  )
  const discountField = firstArrayField.fields?.find(
    (f) => f.kind === "number" && f.key.toLowerCase().includes("discount"),
  )
  // Mirrors the backend's own `extractVatRate` EXACTLY, `looksNumeric` included: a `select` whose
  // key doesn't say "vat" is only a VAT-rate field when its OWN first option looks like a number
  // ("20", "5.5") — options.length > 0 alone also matches a non-numeric dropdown ("standard",
  // "reduced"), which would make this resolve a field the backend never taxes on, and silently show
  // 0 VAT on screen for an invoice the server DOES tax (the divergence this mirrors against).
  const vatRateField = firstArrayField.fields?.find((f) => {
    if (f.kind !== "select") return false
    return (
      f.key.toLowerCase().includes("vat") ||
      (!!f.options && f.options.length > 0 && looksNumeric(f.options[0].value))
    )
  })
  if (!moneyField) return null

  const currency = extractCurrency(descriptor, values)
  const vatRateOptions: VatRateFieldOptions | undefined = vatRateField
    ? { options: vatRateField.options, legacyOptions: vatRateField.legacyOptions }
    : undefined

  // A net total of exactly 0 is a real, showable total (a fully offered line, a 100% discount) —
  // only the absence of any line to sum (checked above) means "nothing to show".
  return computeTotals(
    allLines,
    currency,
    moneyField.key,
    numberField?.key,
    vatRateField?.key,
    discountField?.key,
    t,
    vatRateOptions,
    sellerExemptVat,
  )
}

/** `1234.50 EUR` — one formatter for every figure this module shows, so the header amount and the
 *  totals block never round differently. */
export function formatTotal(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency || "—"}`
}

interface DocumentTotalsProps {
  descriptor: DocumentTypeDescriptor
}

/**
 * Net, VAT breakdown, gross, and the calculator's own warnings — as a plain block, deliberately
 * without a frame of its own: the create dialog shows it under the lines, the detail page inside its
 * own card, and a bordered box inside either would be a card in a card. Renders nothing at all
 * while there is nothing to total (see useDocumentTotals).
 */
export function DocumentTotals({ descriptor }: DocumentTotalsProps) {
  const { t } = useTranslation()
  const totals = useDocumentTotals(descriptor)

  if (!totals) return null

  const currency = totals.currency || "—"
  const decimals = decimalsFor(currency)

  // See `ClientDocumentTotals.showVat`'s own header: false for a VAT-exempt seller, or a document
  // whose every line resolves to exactly 0% VAT — there is no amount a "VAT ... 0.00" row would add
  // over the total already shown below, so it (and the now-identical "Net" row) is skipped entirely
  // rather than printed at zero.
  const showVat = totals.showVat

  return (
    <div data-cy="document-totals">
      <dl className="space-y-2 text-sm">
        {showVat && (
          <div className="flex justify-between gap-4 font-medium" data-cy="document-totals-net">
            <dt>{t("documents.totals.net")}</dt>
            <dd className="amount">{formatTotal(totals.netMinor, currency)}</dd>
          </div>
        )}

        {showVat &&
          totals.vatBreakdown.map((entry) => (
            <div
              key={`vat-${entry.ratePercent}`}
              data-cy="document-totals-vat"
              className="flex justify-between gap-4 text-xs text-muted-foreground"
            >
              <dt>
                {t("documents.totals.vat", {
                  rate: entry.ratePercent.toString(),
                  base: fromMinor(entry.baseMinor, currency).toFixed(decimals),
                })}
              </dt>
              <dd className="amount">{formatTotal(entry.vatMinor, currency)}</dd>
            </div>
          ))}

        <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
          <dt>{t("documents.totals.gross")}</dt>
          <dd className="amount text-base" data-cy="document-totals-gross">
            {formatTotal(totals.grossMinor, currency)}
          </dd>
        </div>
      </dl>

      {totals.warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md bg-warning p-2">
          {totals.warnings.map((warning) => (
            <p key={warning} className="text-xs text-warning-foreground">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

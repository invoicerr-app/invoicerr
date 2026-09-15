import { useMemo } from "react"
import { useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import type { DocumentTypeDescriptor } from "@/components/documents/types"
import { computeTotals, decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { extractCurrency, findLineArrayFields } from "@/components/documents/totals-shape"

/**
 * The LIVE totals (net, VAT breakdown, gross) of the document form currently mounted around this
 * hook — mirrors the backend's compute-totals.ts logic exactly, recomputed on every form change.
 * Null when the form has no line rows yet, no money subfield to sum, or sums to nothing. Must be
 * called inside a react-hook-form `<Form>` (it watches the whole form): DocumentTotals below renders
 * it, and the detail page's header reads it once more for the headline amount.
 */
export function useDocumentTotals(descriptor: DocumentTypeDescriptor) {
  const arrayFields = useMemo(() => findLineArrayFields(descriptor), [descriptor])
  const formValues = useWatch()

  return useMemo(() => {
    if (!formValues || arrayFields.length === 0) return null

    // Collect all lines from all array fields
    const allLines: Array<Record<string, unknown>> = []
    for (const arrayField of arrayFields) {
      const arrayValue = formValues[arrayField.key]
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
    const vatRateField = firstArrayField.fields?.find((f) => {
      if (f.kind !== "select") return false
      return f.key.toLowerCase().includes("vat") || (f.options && f.options.length > 0)
    })
    if (!moneyField) return null

    const currency = extractCurrency(descriptor, formValues)
    const totals = computeTotals(
      allLines,
      currency,
      moneyField.key,
      numberField?.key,
      vatRateField?.key,
      discountField?.key,
    )
    return totals.netMinor === 0 ? null : totals
  }, [formValues, arrayFields, descriptor])
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

  return (
    <div data-cy="document-totals">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4 font-medium">
          <dt>{t("documents.totals.net")}</dt>
          <dd className="amount">{formatTotal(totals.netMinor, currency)}</dd>
        </div>

        {totals.vatBreakdown.map((entry) => (
          <div
            key={`vat-${entry.ratePercent}`}
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

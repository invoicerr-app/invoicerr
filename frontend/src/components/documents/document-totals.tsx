import { useMemo } from "react"
import { useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import type { DocumentTypeDescriptor } from "@/components/documents/types"
import { computeTotals, decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { extractCurrency, findLineArrayFields } from "@/components/documents/totals-shape"

interface DocumentTotalsProps {
  descriptor: DocumentTypeDescriptor
}

/**
 * Displays computed totals (net, VAT breakdown, gross) for a document form.
 * Mirrors backend compute-totals.ts logic exactly, recomputed on every form change.
 * Displays warnings about ignored/unresolvable fields inline.
 */
export function DocumentTotals({ descriptor }: DocumentTotalsProps) {
  const { t } = useTranslation()

  const arrayFields = useMemo(() => findLineArrayFields(descriptor), [descriptor])

  // TOUS les hooks avant le moindre retour anticipé : un `return null` placé entre deux hooks les
  // rend conditionnels, et React plante à la première variation du nombre de hooks entre deux
  // rendus — précisément quand le descripteur change de forme, c'est-à-dire au pire moment.
  const formValues = useWatch()

  // Memoize totals computation (changes only when relevant fields change)
  const totals = useMemo(() => {
    if (!formValues) return null

    // Collect all lines from all array fields
    const allLines: Array<Record<string, unknown>> = []

    for (const arrayField of arrayFields) {
      const arrayValue = formValues[arrayField.key]
      const rows = Array.isArray(arrayValue) ? (arrayValue as Record<string, unknown>[]) : []
      allLines.push(...rows)
    }

    if (allLines.length === 0) {
      return null
    }

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

    if (!moneyField) {
      return null
    }

    const currency = extractCurrency(descriptor, formValues)

    return computeTotals(
      allLines,
      currency,
      moneyField.key,
      numberField?.key,
      vatRateField?.key,
      discountField?.key,
    )
  }, [formValues, arrayFields, descriptor])

  if (!totals || totals.netMinor === 0) {
    return null
  }

  const currency = totals.currency || "—"
  const decimals = decimalsFor(currency)
  const netDisplay = fromMinor(totals.netMinor, currency).toFixed(decimals)
  const grossDisplay = fromMinor(totals.grossMinor, currency).toFixed(decimals)

  if (arrayFields.length === 0) {
    return null // Pas de champ « lignes » : rien à totaliser
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4" data-cy="document-totals">
      <div className="space-y-2 text-sm">
        {/* Net */}
        <div className="flex justify-between font-medium">
          <span>{t("documents.totals.net")}</span>
          <span>
            {netDisplay} {currency}
          </span>
        </div>

        {/* VAT breakdown */}
        {totals.vatBreakdown.map((entry) => {
          const baseDisplay = fromMinor(entry.baseMinor, currency).toFixed(decimals)
          const vatDisplay = fromMinor(entry.vatMinor, currency).toFixed(decimals)
          return (
            <div key={`vat-${entry.ratePercent}`} className="flex justify-between text-xs text-gray-600">
              <span>
                {t("documents.totals.vat", {
                  rate: entry.ratePercent.toString(),
                  base: baseDisplay,
                })}
              </span>
              <span>
                {vatDisplay} {currency}
              </span>
            </div>
          )
        })}

        {/* Gross total */}
        <div className="flex justify-between border-t border-gray-300 pt-2 font-bold">
          <span>{t("documents.totals.gross")}</span>
          <span data-cy="document-totals-gross">
            {grossDisplay} {currency}
          </span>
        </div>
      </div>

      {/* Warnings */}
      {totals.warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded bg-yellow-50 p-2">
          {totals.warnings.map((warning) => (
            <p key={warning} className="text-xs text-yellow-800">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

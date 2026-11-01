import type React from "react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { DocumentFieldValue } from "@/components/documents/field-value"
import { computeDocumentTotals, formatTotal, fromDerivedTotals } from "@/components/documents/document-totals"
import { isEmptyFieldValue, resolveListFields } from "@/components/documents/list-fields"
import { toMinor } from "@/components/documents/totals-calculator"
import { findLineArrayFields } from "@/components/documents/totals-shape"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { LtrValue } from "@/components/ui/ltr-value"
import { useCompany } from "@/hooks/queries"

interface DocumentPaperProps {
  descriptor: DocumentTypeDescriptor
  data: Record<string, unknown>
  displayNumber?: string | null
  derivedTotals?: DocumentInstance["derivedTotals"]
  /** Replaces the sheet's own totals block, for a caller that already shows live totals. */
  totals?: React.ReactNode
}

/**
 * An issued record as a flat sheet: the type and number, the seller, who it is for, the lines and
 * the totals, read from the SAVED data. Generic: every part comes from the descriptor (its list
 * fields, its line array, its money and number subfields), never from a document type's name. The
 * PDF stays the legal artefact; this is the reading view.
 */
export function DocumentPaper({
  descriptor,
  data,
  displayNumber,
  derivedTotals,
  totals: totalsSlot,
}: DocumentPaperProps) {
  const { t } = useTranslation()
  const { data: company } = useCompany()

  const titleFields = resolveListFields(descriptor, descriptor.listItem?.titleFields)
  const secondaryFields = resolveListFields(descriptor, descriptor.listItem?.secondaryFields).filter(
    (field) => !isEmptyFieldValue(data[field.key]),
  )
  const lineField = findLineArrayFields(descriptor)[0]
  const rows =
    lineField && Array.isArray(data[lineField.key]) ? (data[lineField.key] as Record<string, unknown>[]) : []
  const describe =
    lineField?.fields?.find((field) => field.key === "description") ??
    lineField?.fields?.find((field) => field.kind === "text" || field.kind === "longText")
  const quantity = lineField?.fields?.find(
    (field) => field.kind === "number" && !field.key.toLowerCase().includes("discount"),
  )
  const unitPrice = lineField?.fields?.find((field) => field.kind === "money")

  const totals = useMemo(
    () => (derivedTotals ? fromDerivedTotals(derivedTotals) : computeDocumentTotals(descriptor, data)),
    [descriptor, data, derivedTotals],
  )
  const currency = totals?.currency || ""

  return (
    <article
      className="paper-sheet px-6 py-8 text-sm sm:px-12 sm:py-12"
      aria-label={t("documents.paper.ariaLabel", { label: descriptor.label })}
      data-cy="document-paper"
    >
      <header className="flex flex-col justify-between gap-6 sm:flex-row">
        <div>
          <p className="font-heading text-[32px] leading-none">{descriptor.label}</p>
          {displayNumber && <p className="mt-2 tabular-nums text-muted-foreground">{displayNumber}</p>}
        </div>
        {company && (
          <div className="text-muted-foreground sm:text-end">
            <p className="font-semibold text-foreground">{company.name}</p>
            {company.address && <p>{company.address}</p>}
            {(company.postalCode || company.city) && (
              <p>{[company.postalCode, company.city].filter(Boolean).join(" ")}</p>
            )}
          </div>
        )}
      </header>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {titleFields.some((field) => !isEmptyFieldValue(data[field.key])) && (
          <div>
            <p className="text-xs text-muted-foreground">{t("documents.paper.for")}</p>
            <p className="mt-1 font-semibold">
              {titleFields.map((field) => (
                <span key={field.key} className="block">
                  <DocumentFieldValue field={field} value={data[field.key]} data={data} />
                </span>
              ))}
            </p>
          </div>
        )}
        {secondaryFields.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:justify-self-end">
            {secondaryFields.map((field) => (
              <div key={field.key} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="tabular-nums">
                  <DocumentFieldValue field={field} value={data[field.key]} data={data} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {rows.length > 0 && (
        <table className="mt-10 w-full border-collapse">
          <thead className="sr-only">
            <tr>
              <th scope="col">{describe?.label}</th>
              <th scope="col">{t("documents.paper.amount")}</th>
            </tr>
          </thead>
          <tbody className="border-t">
            {rows.map((row, index) => {
              const net = totals?.lines.find((line) => line.index === index)?.netMinor
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: line rows carry no identity of their own
                <tr key={index} className="border-b align-top">
                  <td className="py-3 pe-4">
                    <p>{describe ? String(row[describe.key] ?? "") : ""}</p>
                    {quantity && unitPrice && (
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {String(row[quantity.key] ?? 1)} ×{" "}
                        <LtrValue>
                          {formatTotal(toMinor(Number(row[unitPrice.key] ?? 0), currency), currency)}
                        </LtrValue>
                      </p>
                    )}
                  </td>
                  <td className="amount py-3 text-end whitespace-nowrap">
                    {net !== undefined && <LtrValue>{formatTotal(net, currency)}</LtrValue>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {totalsSlot && <div className="ms-auto mt-6 w-full max-w-xs">{totalsSlot}</div>}
      {!totalsSlot && totals && (
        <dl className="ms-auto mt-6 w-full max-w-xs space-y-1.5">
          {totals.showVat && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <dt>{t("documents.totals.net")}</dt>
              <dd className="amount">
                <LtrValue>{formatTotal(totals.netMinor, currency)}</LtrValue>
              </dd>
            </div>
          )}
          {totals.showVat &&
            totals.vatBreakdown.map((entry) => (
              <div key={entry.ratePercent} className="flex justify-between gap-4 text-muted-foreground">
                <dt>{t("documents.paper.vatAt", { rate: entry.ratePercent })}</dt>
                <dd className="amount">
                  <LtrValue>{formatTotal(entry.vatMinor, currency)}</LtrValue>
                </dd>
              </div>
            ))}
          <div className="flex items-baseline justify-between gap-4 border-t border-b-[3px] border-double border-b-foreground/70 pt-2 pb-2">
            <dt className="font-semibold">{t("documents.totals.gross")}</dt>
            <dd className="amount text-2xl">
              <LtrValue>{formatTotal(totals.grossMinor, currency)}</LtrValue>
            </dd>
          </div>
        </dl>
      )}
    </article>
  )
}

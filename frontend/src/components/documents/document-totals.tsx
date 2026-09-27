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
import { commonLinesOf, deriveQuoteOptions, linesForOption } from "@/components/documents/quote-options"
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
 * Issue #373 ("quotes with options") - the LIVE per-option totals of the form currently mounted,
 * mirroring `useDocumentTotals` above but split by the quote line's own `option` tag. Null for every
 * document type other than "quote" (no other line shape declares an `option` subfield) and for a
 * quote with fewer than two distinct options - see `computeDocumentOptionTotals`'s own header.
 */
export function useDocumentOptionTotals(descriptor: DocumentTypeDescriptor) {
  const { t } = useTranslation()
  const formValues = useWatch()
  const { data: company } = useCompany()
  return useMemo(
    () => computeDocumentOptionTotals(descriptor, formValues, t, company?.exemptVat),
    [formValues, descriptor, t, company?.exemptVat],
  )
}

/** The LIVE mirror of `useDocumentOptionTotals`, for the common (untagged) lines' own informational
 *  total - see `computeCommonLineTotals`'s own header. */
export function useCommonLineTotals(descriptor: DocumentTypeDescriptor) {
  const { t } = useTranslation()
  const formValues = useWatch()
  const { data: company } = useCompany()
  return useMemo(
    () => computeCommonLineTotals(descriptor, formValues, t, company?.exemptVat),
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

export interface DocumentOptionTotals {
  option: string
  totals: ClientDocumentTotals
}

/**
 * The pure half of `useDocumentOptionTotals`: per-option totals for ANY `values` object shaped like
 * the quote's own data - the live form above, or a SAVED record's `instance.data` (the detail page's
 * own totals card, list rows). Null for a document type whose line shape declares no `option`
 * subfield at all (every type but "quote" today), or for a quote with fewer than two distinct
 * options (`deriveQuoteOptions`) - the caller then falls back to the ordinary single
 * `computeDocumentTotals` above, exactly as before this feature existed. For 2+ options, each entry
 * is computed by filtering the SAME lines array down to that option's own rows and handing the
 * result to the EXISTING `computeDocumentTotals` - no separate arithmetic, so this can never disagree
 * with the single-total path's own rounding/VAT rules. Deliberately no global total alongside these -
 * see the backend's own `options/quote-options.ts#computeQuoteOptionTotals` header for why. Each
 * option's own rows are its own tagged lines PLUS every common (untagged) line
 * (`quote-options.ts#linesForOption`'s own header) - a "Setup fee" line nobody tagged is counted in
 * EVERY option's total, never silently dropped from any of them.
 */
export function computeDocumentOptionTotals(
  descriptor: DocumentTypeDescriptor,
  values: Record<string, unknown> | undefined,
  t?: TFunction,
  sellerExemptVat?: boolean,
): DocumentOptionTotals[] | null {
  const arrayFields = findLineArrayFields(descriptor)
  if (!values || arrayFields.length === 0) return null

  const firstArrayField = arrayFields[0]
  const hasOptionSubfield = firstArrayField.fields?.some((f) => f.key === "option")
  if (!hasOptionSubfield) return null

  const rows = Array.isArray(values[firstArrayField.key])
    ? (values[firstArrayField.key] as Record<string, unknown>[])
    : []
  const options = deriveQuoteOptions(rows)
  if (options.length < 2) return null

  return options.map((option) => {
    const optionRows = linesForOption(rows, option)
    const totals = computeDocumentTotals(
      descriptor,
      { ...values, [firstArrayField.key]: optionRows },
      t,
      sellerExemptVat,
    )
    // Unreachable in practice - `optionRows` is never empty by construction (it is exactly how
    // `option` was derived in the first place) - but `computeDocumentTotals` returns null on genuinely
    // empty input, so this narrows the type rather than asserting past a real null.
    return {
      option,
      totals: totals ?? {
        currency: null,
        lines: [],
        netMinor: 0,
        vatMinor: 0,
        grossMinor: 0,
        vatBreakdown: [],
        warnings: [],
        showVat: false,
      },
    }
  })
}

/**
 * Issue #373 follow-up ("common lines") - the frontend mirror of the backend's own
 * `computeCommonLineTotals`: the common (untagged) lines' OWN informational total, shown alongside
 * the per-option blocks so a reader can see where each option's own common contribution came from.
 * Null whenever `computeDocumentOptionTotals` itself would be (fewer than two options, or no `option`
 * subfield at all), or when every line IS tagged.
 */
export function computeCommonLineTotals(
  descriptor: DocumentTypeDescriptor,
  values: Record<string, unknown> | undefined,
  t?: TFunction,
  sellerExemptVat?: boolean,
): ClientDocumentTotals | null {
  const arrayFields = findLineArrayFields(descriptor)
  if (!values || arrayFields.length === 0) return null

  const firstArrayField = arrayFields[0]
  const hasOptionSubfield = firstArrayField.fields?.some((f) => f.key === "option")
  if (!hasOptionSubfield) return null

  const rows = Array.isArray(values[firstArrayField.key])
    ? (values[firstArrayField.key] as Record<string, unknown>[])
    : []
  if (deriveQuoteOptions(rows).length < 2) return null

  const commonRows = commonLinesOf(rows)
  if (commonRows.length === 0) return null

  return computeDocumentTotals(
    descriptor,
    { ...values, [firstArrayField.key]: commonRows },
    t,
    sellerExemptVat,
  )
}

/**
 * Orchestrator review follow-up ("no meaningless common total") - the common (untagged) lines' own
 * DESCRIPTIONS, for the block that replaces `computeCommonLineTotals`'s totals rows in `DocumentTotals`
 * below: printing a "Total" for lines nobody has actually committed to (they are only ever billed as
 * part of whichever option gets chosen) read like a price the client could pay on its own. Showing
 * what the group CONTAINS, with no figure attached, avoids that reading while still telling the user
 * where each option's own (still fully merged) total comes from. Same null/empty rules as
 * `computeCommonLineTotals` (fewer than two options, no `option` subfield, or every line tagged) -
 * this is its sibling, not a replacement; `computeCommonLineTotals` stays for whatever pure
 * computation still wants the merged figure (its own unit tests included), only the RENDER path below
 * stopped reading it.
 */
export function commonLineDescriptions(
  descriptor: DocumentTypeDescriptor,
  values: Record<string, unknown> | undefined,
): string[] | null {
  const arrayFields = findLineArrayFields(descriptor)
  if (!values || arrayFields.length === 0) return null

  const firstArrayField = arrayFields[0]
  const hasOptionSubfield = firstArrayField.fields?.some((f) => f.key === "option")
  if (!hasOptionSubfield) return null

  const rows = Array.isArray(values[firstArrayField.key])
    ? (values[firstArrayField.key] as Record<string, unknown>[])
    : []
  if (deriveQuoteOptions(rows).length < 2) return null

  const commonRows = commonLinesOf(rows)
  if (commonRows.length === 0) return null

  // "description" is this line shape's ONE free-text designation field (the quote descriptor's own
  // `lines.fields` - see that descriptor's own comment on why there is no separate name/description
  // pair) - the same field every other line-rendering path in this app already reads to name a line.
  const descriptionField = firstArrayField.fields?.find((f) => f.key === "description")
  return commonRows.map((row) => {
    const raw = descriptionField ? row[descriptionField.key] : undefined
    return typeof raw === "string" && raw.trim() ? raw.trim() : ""
  })
}

/** The LIVE mirror of `commonLineDescriptions` above, for the form currently mounted. */
export function useCommonLineDescriptions(descriptor: DocumentTypeDescriptor): string[] | null {
  const formValues = useWatch()
  return useMemo(() => commonLineDescriptions(descriptor, formValues), [descriptor, formValues])
}

/** `1234.50 EUR` — one formatter for every figure this module shows, so the header amount and the
 *  totals block never round differently. */
export function formatTotal(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency || "—"}`
}

interface DocumentTotalsProps {
  descriptor: DocumentTypeDescriptor
  /** Issue #373 ("quotes with options") - the option currently recorded as ACCEPTED
   *  (`instance.acceptedOption`), so its own group gets an "Accepted" badge. Undefined for the create
   *  dialog / editor (nothing has been accepted yet - there is no instance at all). */
  acceptedOption?: string | null
}

/** The net/VAT-breakdown/gross rows shared by the single-total block and each per-option group below
 * - extracted so the two can never disagree on rounding or the `showVat` rule (mirrors the
 *  backend's own `render-html.ts#renderTotalsRows` split, same reasoning).
 *
 * `includesCommon` (orchestrator review follow-up, "no meaningless common total"): true only for a
 * REAL option's own block, and only when a common (untagged-lines) group exists alongside it - swaps
 * the gross row's label to `documents.totals.grossIncludingCommon` so a reader can tell this figure
 * already folds the common lines in, without the common group printing a total of its own to point
 * back at (see `DocumentTotals`'s own call sites below, and the backend's identical
 * `render-html.ts#renderTotalsRows` split). The FIGURE itself never changes - `totals` is already the
 * merged one, `computeDocumentOptionTotals`'s own header - only the label. */
function TotalsRows({ totals, includesCommon }: { totals: ClientDocumentTotals; includesCommon?: boolean }) {
  const { t } = useTranslation()
  const currency = totals.currency || "—"
  const decimals = decimalsFor(currency)
  const showVat = totals.showVat

  return (
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
        <dt>{t(includesCommon ? "documents.totals.grossIncludingCommon" : "documents.totals.gross")}</dt>
        <dd className="amount text-base" data-cy="document-totals-gross">
          {formatTotal(totals.grossMinor, currency)}
        </dd>
      </div>

      {totals.warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md bg-warning p-2">
          {totals.warnings.map((warning) => (
            <p key={warning} className="text-xs text-warning-foreground">
              {warning}
            </p>
          ))}
        </div>
      )}
    </dl>
  )
}

/**
 * Net, VAT breakdown, gross, and the calculator's own warnings - as a plain block, deliberately
 * without a frame of its own: the create dialog shows it under the lines, the detail page inside its
 * own card, and a bordered box inside either would be a card in a card. Renders nothing at all
 * while there is nothing to total (see useDocumentTotals).
 *
 * Issue #373 ("quotes with options"): with 2+ options (`useDocumentOptionTotals`), this renders ONE
 * labelled block per option instead - NO global total alongside them, see this module's own
 * `computeDocumentOptionTotals` header for why summing options together would be meaningless.
 */
export function DocumentTotals({ descriptor, acceptedOption }: DocumentTotalsProps) {
  const { t } = useTranslation()
  const optionTotals = useDocumentOptionTotals(descriptor)
  const commonDescriptions = useCommonLineDescriptions(descriptor)
  const totals = useDocumentTotals(descriptor)

  if (optionTotals) {
    return (
      <div data-cy="document-option-totals" className="space-y-4">
        {/* Orchestrator review follow-up ("no meaningless common total") - shown FIRST, before any
            one option's own block: a reader meets "what's in every option" before "what differs
            between them". Lists the group's OWN lines only, deliberately no total underneath them -
            these lines are never billed on their own, only as part of whichever option gets chosen,
            and a standalone figure here read like a price the client could pay by itself. Each real
            option's own block below still folds this contribution into its own (unchanged) printed
            total - see that block's own `includesCommon` note. */}
        {commonDescriptions && commonDescriptions.length > 0 && (
          <div data-cy="document-common-line-totals">
            <div className="mb-1 text-sm font-semibold">{t("documents.totals.commonToAllOptions")}</div>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {commonDescriptions.map((description, index) => (
                // These are plain, possibly-repeatable designations (two "Setup fee" lines are a
                // real, valid quote), not identified rows - the same reasoning `array-field.tsx`'s
                // own row rendering already documents.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are structural, not identified
                <li key={index} data-cy="document-common-line-description">
                  {description || t("documents.totals.commonToAllOptions")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {optionTotals.map(({ option, totals: t2 }) => (
          <div key={option} data-cy="document-option-total-group">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <span data-cy="document-option-total-name">{option}</span>
              {acceptedOption === option && (
                <span
                  className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal uppercase tracking-wide text-primary"
                  data-cy="document-option-accepted-badge"
                >
                  {t("documents.totals.optionAccepted")}
                </span>
              )}
            </div>
            <TotalsRows totals={t2} includesCommon={!!commonDescriptions && commonDescriptions.length > 0} />
          </div>
        ))}
      </div>
    )
  }

  if (!totals) return null

  return (
    <div data-cy="document-totals">
      <TotalsRows totals={totals} />
    </div>
  )
}

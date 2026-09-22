import { useTranslation } from "react-i18next"

import { useDocumentTaxWarnings } from "@/hooks/queries"

interface DocumentTaxWarningsProps {
  warnings: string[]
}

/**
 * The non-fatal caveats the server's cross-border tax resolution recorded about THIS document's own
 * amounts — "this buyer's VAT number has not been confirmed, so the sale is taxed as a consumer
 * sale", "only the destination's standard rate could be applied, so a reduced-rated product is
 * over-charged". Each one changes a number the reader is looking at two lines above, which is the
 * whole reason it lives inside the totals card rather than in a notifications tray.
 *
 * NOT an error, and deliberately does not look like one: the document is valid, can be sent, and in
 * most cases the treatment is simply what the seller intended. So this reuses the EXACT block this
 * screen already gives every other server-formed caveat — the same `bg-warning` panel as
 * `DocumentTotals`'s own calculator warnings right above it, the settlement section's ignored-credit
 * warnings, and the create dialog's line-total warnings — rather than an `Alert`, a destructive tone,
 * or a third visual language invented for tax.
 *
 * It DOES carry a title those others do not, and that is the one deliberate difference: two
 * identical unlabelled panels stacked inside one card would read as one long list, and these say
 * something categorically different from "line 3 has no usable VAT rate" — one is about a field the
 * user can fix on this form, the other about how a tax was determined.
 *
 * Renders NOTHING — no panel, no heading, no empty state — when there is nothing to say, which is the
 * common case: a domestic invoice, and every document type but the invoice, always answers an empty
 * list.
 *
 * The warning text itself is the server's, shown VERBATIM and untranslated, exactly like the three
 * neighbours named above. There is no key to look up: the backend forms English prose and
 * interpolates country codes, rates and the buyer's own VAT number into it, so nothing in a locale
 * file could render it. Only the title is this screen's own string, and it goes through `t()`.
 */
export function DocumentTaxWarnings({ warnings }: DocumentTaxWarningsProps) {
  const { t } = useTranslation()

  if (warnings.length === 0) return null

  return (
    <div className="mt-3 space-y-1 rounded-md bg-warning p-2" data-cy="document-tax-warnings">
      <p className="text-xs font-semibold uppercase tracking-wide text-warning-foreground">
        {t("documents.totals.taxWarningsTitle")}
      </p>
      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-warning-foreground" data-cy="document-tax-warning">
          {warning}
        </p>
      ))}
    </div>
  )
}

interface DocumentTaxWarningsSectionProps {
  typeId: string
  documentId: string
}

/**
 * The fetching half. No skeleton and no error branch on purpose: an answer that has not arrived, or
 * one that failed, must leave the totals card looking exactly as it does when there is nothing to
 * warn about — a placeholder box on every document would cost every reader attention to say
 * "probably nothing", and the endpoint already reports a blocked resolution as an empty list rather
 * than as a failure (see the backend's `DocumentsService.getTaxWarnings`).
 */
export function DocumentTaxWarningsSection({ typeId, documentId }: DocumentTaxWarningsSectionProps) {
  const { data } = useDocumentTaxWarnings(typeId, documentId)
  return <DocumentTaxWarnings warnings={data?.warnings ?? []} />
}

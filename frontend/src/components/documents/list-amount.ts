import {
  acceptedOptionTotals,
  computeDocumentOptionTotals,
  computeDocumentTotals,
} from "@/components/documents/document-totals"
import { toMinor } from "@/components/documents/totals-calculator"
import { extractCurrency } from "@/components/documents/totals-shape"
import type { DerivedDocumentTotals, DocumentTypeDescriptor } from "@/components/documents/types"

export interface RowAmount {
  minor: number
  currency: string
  /** The top-level field the figure was read from, when it was one — so the list's secondary line
   *  can skip repeating it. Undefined when the figure was summed from line rows. */
  fieldKey?: string
}

/**
 * The one figure a list row shows for a saved record — "what is this worth", right-aligned in the
 * mono face. Two generic sources, never a per-type rule:
 *  1. a type with line rows (invoice, quote, credit note, purchase order…) gets the gross total of
 *     those lines, through the exact same arithmetic the detail page's totals card uses;
 *  2. otherwise the first top-level `money` field that carries a value (an expense's `amount`, a
 *     received invoice's `grossAmount`), in its own declared currency.
 * Null when neither applies - the row simply shows no amount, it never invents one. Also null -  * issue #373 ("quotes with options") - for a quote offering 2+ options: summing every option's
 * lines together would be exactly the meaningless total this issue exists to stop printing, so the
 * row shows no amount at all rather than a wrong one (the same "never invents one" contract this
 * function already holds for every other gap). Issue #479: once an option is accepted
 * (`acceptedOption`, by signature or manual acceptance), the row shows THAT option's own total again.
 * Issue #507: `derivedTotals` (a LINKED credit note's, computed by the backend from the invoice it
 * corrects - see `DocumentInstance.derivedTotals`) wins over both sources above, since the row's own
 * `lines` are empty by construction and would read 0.00.
 */
export function resolveRowAmount(
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
  acceptedOption?: string | null,
  derivedTotals?: DerivedDocumentTotals | null,
): RowAmount | null {
  if (derivedTotals?.currency) return { minor: derivedTotals.grossMinor, currency: derivedTotals.currency }

  const optionTotals = computeDocumentOptionTotals(descriptor, data)
  if (optionTotals) {
    const accepted = acceptedOptionTotals(optionTotals, acceptedOption)
    return accepted?.currency ? { minor: accepted.grossMinor, currency: accepted.currency } : null
  }

  const totals = computeDocumentTotals(descriptor, data)
  if (totals && totals.currency) {
    return { minor: totals.grossMinor, currency: totals.currency }
  }

  for (const field of descriptor.fields) {
    if (field.kind !== "money") continue
    const raw = data[field.key]
    const amount = typeof raw === "number" ? raw : Number(raw)
    if (raw === undefined || raw === null || raw === "" || Number.isNaN(amount)) continue
    const currency =
      (field.currencyField ? (data[field.currencyField] as string | undefined) : field.currency) ??
      extractCurrency(descriptor, data)
    if (!currency) continue
    return { minor: toMinor(amount, currency), currency, fieldKey: field.key }
  }

  return null
}

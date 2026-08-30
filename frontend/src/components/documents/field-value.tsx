import { useTranslation } from "react-i18next"

import {
  isMultiTargetReference,
  type DocumentFieldDescriptor,
  type MultiTargetReferenceValue,
} from "@/components/documents/types"
import { useReferenceResolve } from "@/hooks/queries"

interface ReferenceValueProps {
  field: DocumentFieldDescriptor
  value: unknown
}

/** A 'reference' field's stored value is an id (or `{ entity, id }` for a multi-target one, see
 *  types.ts) — never the human label a reader actually wants. This is the read-only counterpart to
 *  field-renderers/reference-field.tsx's own resolve call, kept in its own component because it
 *  needs a hook (async) where every other kind below is a pure, synchronous formatting. */
function ReferenceValue({ field, value }: ReferenceValueProps) {
  const multi = isMultiTargetReference(field)
  const multiValue = multi ? (value as MultiTargetReferenceValue | undefined) : undefined
  const entity = multi ? multiValue?.entity : field.entity
  const id = multi ? multiValue?.id : (value as string | undefined)
  const { data: resolved, isLoading } = useReferenceResolve(entity, id)

  if (!id) return <span className="text-muted-foreground">—</span>
  if (isLoading) return <span className="text-muted-foreground">…</span>
  return <span>{resolved?.label ?? id}</span>
}

interface DocumentFieldValueProps {
  field: DocumentFieldDescriptor
  value: unknown
  /** The row's full data — needed only by 'money' to resolve a `currencyField` sibling, mirroring
   *  what field-renderers/primitive-fields.tsx's MoneyField does for the editable version. */
  data?: Record<string, unknown>
}

/**
 * Read-only rendering of one field's VALUE, by KIND — the display counterpart to field-renderers/*
 * (which render an EDITABLE control for the same kind). Used wherever a value is shown rather than
 * edited: the document list's columns (document-list.tsx) and the honest data preview a custom slot
 * can add (custom/invoice-preview-button.tsx) both go through this, so a kind is formatted exactly
 * the same way in both places.
 *
 * Never switches on a document TYPE, only on `field.kind`. An unrecognized kind still shows the raw
 * value rather than nothing — the same "never hide" discipline DocumentField's own fallback holds
 * for the editable form, just without the harsher "unsupported" styling: a display glitch here is
 * not the same severity as a form silently dropping a value the user's data actually has.
 */
export function DocumentFieldValue({ field, value, data }: DocumentFieldValueProps) {
  const { t } = useTranslation()

  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground">—</span>
  }

  switch (field.kind) {
    case "text":
      return <span>{String(value)}</span>

    case "longText":
      return <span className="line-clamp-2 whitespace-pre-line">{String(value)}</span>

    case "number":
      return <span>{String(value)}</span>

    case "money": {
      const currency = field.currencyField
        ? (data?.[field.currencyField] as string | undefined)
        : field.currency
      const amount = typeof value === "number" ? value : Number(value)
      return (
        <span>
          {Number.isNaN(amount)
            ? String(value)
            : t("common.valueWithCurrency", { amount: amount.toFixed(2), currency: currency ?? "" })}
        </span>
      )
    }

    case "date": {
      const parsed = new Date(value as string)
      return <span>{Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString()}</span>
    }

    case "boolean":
      return <span>{value ? t("documents.list.fieldValue.yes") : t("documents.list.fieldValue.no")}</span>

    case "select": {
      const option = field.options?.find((o) => o.value === value)
      return <span>{option?.label ?? String(value)}</span>
    }

    case "reference":
      return <ReferenceValue field={field} value={value} />

    case "array": {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
      if (rows.length === 0) return <span className="text-muted-foreground">—</span>
      const subFields = field.fields ?? []
      return (
        <ul className="space-y-1">
          {rows.map((row, index) => (
            // Rows have no stable identity at this layer (that is exactly what 'rowSelection' — see
            // the next case — exists to add on top of an 'array'); position is all there is here.
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are structural, not identified
            <li key={index} className="text-sm">
              {subFields.map((sub, subIndex) => (
                <span key={sub.key} className="mr-3 inline-flex items-center gap-1">
                  {subIndex > 0 && <span className="text-muted-foreground">·</span>}
                  <DocumentFieldValue field={sub} value={row[sub.key]} data={row} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      )
    }

    case "rowSelection": {
      const count = Array.isArray(value) ? value.length : 0
      return <span>{t("documents.list.fieldValue.rowCount", { count })}</span>
    }

    default:
      return <span className="text-muted-foreground">{JSON.stringify(value)}</span>
  }
}

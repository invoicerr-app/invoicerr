import { useTranslation } from "react-i18next"

import { getFieldRenderer } from "@/components/documents/field-renderers"
import type { DocumentFieldDescriptor } from "@/components/documents/types"

interface DocumentFieldProps {
  field: DocumentFieldDescriptor
  name: string
}

/**
 * The one place a document's fields turn into UI: looks up a renderer by field KIND (never by
 * document type) and delegates entirely. An unregistered kind is shown, not hidden — a plugin that
 * declares a field kind without registering its renderer is a configuration bug, and this is where
 * it becomes visible instead of silently dropping a field the user's data actually has.
 */
export function DocumentField({ field, name }: DocumentFieldProps) {
  const { t } = useTranslation()
  const Renderer = getFieldRenderer(field.kind)

  if (!Renderer) {
    return (
      <div
        className="rounded-md border border-dashed border-destructive/50 p-3 text-sm text-destructive"
        data-cy={`document-field-${field.key}-unsupported`}
      >
        {t("documents.form.unsupportedKind", { label: field.label, kind: field.kind })}
      </div>
    )
  }

  return <Renderer field={field} name={name} />
}

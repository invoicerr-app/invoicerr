import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useFieldArray, useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DocumentField } from "@/components/documents/document-field"
import SearchSelect from "@/components/search-input"
import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { fetchPrefillFields, useReferenceSearch } from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

/**
 * A 'select' target's stored value is always a string (field-kinds.ts's own 'select' validator); an
 * entity's raw field (e.g. `Article.vatRate`) might be a plain number. This is the ONE, generic
 * coercion `prefillFrom` needs — keyed by the TARGET field's KIND, never by which entity or document
 * type is involved, the same discipline every other kind-generic piece of this form already holds.
 * Every other kind's value is copied verbatim: a 'money'/'number' field wants a number (which is
 * exactly what an Article's `unitPrice` already is), a 'text' field wants a string either way.
 */
function coercePrefillValue(targetKind: string | undefined, value: unknown): unknown {
  if (value === undefined || value === null) return value
  return targetKind === "select" ? String(value) : value
}

interface RowPrefillPickerProps {
  arrayFieldKey: string
  rowIndex: number
  entity: string
  map: Record<string, string>
  rowFields: DocumentFieldDescriptor[]
  onPrefill: (values: Record<string, unknown>) => void
}

/**
 * The "fill from catalog" button one ROW gets when its array field declares `prefillFrom`
 * (descriptors/types.ts, backend) — e.g. an invoice/quote line picking an Article. Reuses the exact
 * same generic reference-search endpoint a 'reference' FIELD already uses (`useReferenceSearch`,
 * `/api/documents/references/:entity/search`) for the picker's own options; the one thing THIS
 * component adds is resolving the picked id's raw FIELDS (`fetchPrefillFields`, the entity's
 * OPTIONAL `getFields` — see reference-registry.ts) and copying the mapped ones onto the row. Never
 * names "article" or any document type: `entity`/`map` come entirely from the descriptor.
 *
 * A pure action trigger, like the old, now-orphaned ArticlePicker it replaces (component/
 * article-picker.tsx) — it keeps no selected value of its own, `value` is always "".
 */
function RowPrefillPicker({
  arrayFieldKey,
  rowIndex,
  entity,
  map,
  rowFields,
  onPrefill,
}: RowPrefillPickerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const { data: options = [] } = useReferenceSearch(entity, search)

  const handleSelect = async (value: string | string[]) => {
    const id = Array.isArray(value) ? value[0] : value
    if (!id) return
    // A provider with no `getFields` (most reference entities) resolves this to null — the button
    // still opened the picker, it simply has nothing to copy over. Never a crash either way.
    const sourceFields = await fetchPrefillFields(entity, id)
    if (!sourceFields) return

    const values: Record<string, unknown> = {}
    for (const [rowKey, sourceKey] of Object.entries(map)) {
      const targetKind = rowFields.find((rowField) => rowField.key === rowKey)?.kind
      values[rowKey] = coercePrefillValue(targetKind, sourceFields[sourceKey])
    }
    onPrefill(values)
  }

  return (
    <SearchSelect
      className="w-full sm:w-56"
      value=""
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      onValueChange={handleSelect}
      onSearchChange={setSearch}
      placeholder={t("documents.form.array.prefillButton")}
      searchPlaceholder={t("documents.form.array.prefillSearchPlaceholder")}
      noResultsText={t("documents.form.array.prefillNoResults")}
      data-cy={`document-field-${arrayFieldKey}-row-${rowIndex}-prefill`}
    />
  )
}

/**
 * The one recursive core kind: a row is just another `data` object rendered against `field.fields`
 * — the same DocumentField every top-level field goes through, which is what makes "a table of
 * sub-fields" a structural feature of the core rather than a per-document-type special case.
 *
 * Uses plain <Label>, not <FormLabel>: the array as a whole isn't bound to one react-hook-form
 * Controller (each ROW's sub-fields are, individually), so there is no single field name for
 * <FormLabel>'s error-aware styling to attach to here.
 */
export function ArrayField({ field, name, documentTypeId }: FieldRendererProps) {
  const { t } = useTranslation()
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext()
  const { fields: rows, append, remove } = useFieldArray({ control, name })
  const rowFields = field.fields ?? []

  const emptyRow = Object.fromEntries(rowFields.map((rowField) => [rowField.key, undefined]))
  const arrayError = (errors as Record<string, { message?: string }>)[name]?.message

  return (
    <div className="space-y-2" data-cy={`document-field-${field.key}`}>
      <Label>
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>
      {field.helpText && <p className="text-sm text-muted-foreground">{field.helpText}</p>}

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="space-y-2 rounded-md border p-3"
            data-cy={`document-field-${field.key}-row-${index}`}
          >
            {field.prefillFrom && (
              <div className="flex justify-end">
                <RowPrefillPicker
                  arrayFieldKey={field.key}
                  rowIndex={index}
                  entity={field.prefillFrom.entity}
                  map={field.prefillFrom.map}
                  rowFields={rowFields}
                  onPrefill={(values) => {
                    for (const [rowKey, value] of Object.entries(values)) {
                      setValue(`${name}.${index}.${rowKey}`, value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  }}
                />
              </div>
            )}
            <div className="flex items-start gap-2">
              <div className="grid flex-1 gap-3 sm:grid-cols-3">
                {rowFields.map((rowField) => (
                  <DocumentField
                    key={rowField.key}
                    field={rowField}
                    name={`${name}.${index}.${rowField.key}`}
                    documentTypeId={documentTypeId}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-1 shrink-0"
                onClick={() => remove(index)}
                dataCy={`document-field-${field.key}-remove-row-${index}`}
                aria-label={t("documents.form.array.removeRow")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append(emptyRow)}
        dataCy={`document-field-${field.key}-add-row`}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("documents.form.array.addRow")}
      </Button>

      {arrayError && <p className="text-sm font-medium text-destructive">{arrayError}</p>}
    </div>
  )
}

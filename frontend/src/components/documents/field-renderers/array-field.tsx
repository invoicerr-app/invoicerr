import { Plus, Trash2 } from "lucide-react"
import { useFieldArray, useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DocumentField } from "@/components/documents/document-field"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import type { FieldRendererProps } from "./registry"

/**
 * The one recursive core kind: a row is just another `data` object rendered against `field.fields`
 * — the same DocumentField every top-level field goes through, which is what makes "a table of
 * sub-fields" a structural feature of the core rather than a per-document-type special case.
 *
 * Uses plain <Label>, not <FormLabel>: the array as a whole isn't bound to one react-hook-form
 * Controller (each ROW's sub-fields are, individually), so there is no single field name for
 * <FormLabel>'s error-aware styling to attach to here.
 */
export function ArrayField({ field, name }: FieldRendererProps) {
  const { t } = useTranslation()
  const {
    control,
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
            className="flex items-start gap-2 rounded-md border p-3"
            data-cy={`document-field-${field.key}-row-${index}`}
          >
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              {rowFields.map((rowField) => (
                <DocumentField
                  key={rowField.key}
                  field={rowField}
                  name={`${name}.${index}.${rowField.key}`}
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

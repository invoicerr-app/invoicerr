import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import type React from "react"
import { useFieldArray, useFormContext, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DocumentField } from "@/components/documents/document-field"
import { formatTotal } from "@/components/documents/document-totals"
import SearchSelect from "@/components/search-input"
import { toMinor } from "@/components/documents/totals-calculator"
import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { fetchPrefillFields, useReferenceSearch } from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

/**
 * The "quantity × unit price, less any discount" a row's own subfields describe — same field-KIND
 * detection `document-totals.tsx`'s `computeDocumentTotals` uses for the document-wide totals, so a
 * descriptor never has to name this shape by key. `undefined` when the row has no money subfield at
 * all (an array field that isn't priced lines, e.g. a plain list of identifiers): this is a mobile
 * convenience preview, not a value the form stores or a total anything downstream reads.
 */
function detectPriceFields(rowFields: DocumentFieldDescriptor[]) {
  const moneyField = rowFields.find((f) => f.kind === "money")
  const numberField = rowFields.find((f) => f.kind === "number" && !f.key.toLowerCase().includes("discount"))
  const discountField = rowFields.find((f) => f.kind === "number" && f.key.toLowerCase().includes("discount"))
  return { moneyField, numberField, discountField }
}

/**
 * A 'select' target's stored value is always a string (field-kinds.ts's own 'select' validator); an
 * entity's raw field (e.g. `Article.vatRate`) might be a plain number. This is the ONE, generic
 * coercion `prefillFrom` needs — keyed by the TARGET field's own descriptor, never by which entity or
 * document type is involved, the same discipline every other kind-generic piece of this form already
 * holds. Every other kind's value is copied verbatim: a 'money'/'number' field wants a number (which
 * is exactly what an Article's `unitPrice` already is), a 'text' field wants a string either way.
 *
 * A 'select' field carrying `legacyOptions` (the VAT-rate catalog migration, vat-rates/registry.ts)
 * is the one case a plain `String(value)` used to get wrong: an Article's `vatRate` is still the OLD
 * bare percentage (e.g. `20`), but the field's own `options` (what the SearchSelect trigger actually
 * looks a label up in — primitive-fields.tsx's `SelectField`) now hold catalog ids, not percentages.
 * Resolved by finding the matching `legacyOptions` index and storing the catalog id at that SAME
 * index in `options` instead — compared NUMERICALLY (`20` === `20.0`), since an entity's raw field is
 * never guaranteed to stringify identically to the catalog's own `String(rate.rate)`. Two catalog ids
 * can legally share one percentage (e.g. two 0% categories, see it.json's `it-esente`/
 * `it-non-imponibile`) — the FIRST match, catalog order, wins; a one-click convenience the user can
 * still correct by hand, never a silent wrong pick of legal consequence.
 */
export function coercePrefillValue(
  targetField: DocumentFieldDescriptor | undefined,
  value: unknown,
): unknown {
  if (value === undefined || value === null) return value
  if (targetField?.kind !== "select") return value

  const legacyOptions = targetField.legacyOptions ?? []
  const options = targetField.options ?? []
  const numericValue = Number(value)
  if (legacyOptions.length && options.length && Number.isFinite(numericValue)) {
    const legacyIndex = legacyOptions.findIndex((option) => Number(option.value) === numericValue)
    if (legacyIndex !== -1 && options[legacyIndex]) return options[legacyIndex].value
  }
  return String(value)
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
      const targetField = rowFields.find((rowField) => rowField.key === rowKey)
      values[rowKey] = coercePrefillValue(targetField, sourceFields[sourceKey])
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

interface LineRowCardProps {
  arrayFieldKey: string
  name: string
  index: number
  rowFields: DocumentFieldDescriptor[]
  documentTypeId?: string
  onRemove: () => void
  removeLabel: string
  /** The "fill from catalog" picker, when the array field declares `prefillFrom` — rendered inside
   *  this card, above the designation row, rather than threading that whole feature down here. */
  prefillSlot?: React.ReactNode
}

/**
 * One line, as a mobile-first card: the row's FIRST subfield (every descriptor that reuses this
 * shape declares its free-text designation there — description.tsx's own header on `invoice.
 * descriptor.ts`) spans the full width up top, a live subtotal preview sits at its right when the
 * row prices something, and everything else wraps into a 2-column grid below — 3 at `sm:` and up,
 * unchanged from before this card treatment. Owner feedback (2026-09-16): the previous flat grid of
 * 4-6 equally-sized fields read as "too compressed" at 390px, with no visual anchor for which field
 * was the one that actually names the line.
 */
function LineRowCard({
  arrayFieldKey,
  name,
  index,
  rowFields,
  documentTypeId,
  onRemove,
  removeLabel,
  prefillSlot,
}: LineRowCardProps) {
  const { control, watch } = useFormContext()
  const [headField, ...restFields] = rowFields
  const { moneyField, numberField, discountField } = detectPriceFields(rowFields)

  const rowPath = `${name}.${index}`
  const row = useWatch({ control, name: rowPath }) as Record<string, unknown> | undefined
  const currency = moneyField?.currencyField ? watch(moneyField.currencyField) : moneyField?.currency

  let subtotal: string | null = null
  if (moneyField && row) {
    const unitPriceRaw = row[moneyField.key]
    if (typeof unitPriceRaw === "number") {
      const quantityRaw = numberField ? row[numberField.key] : undefined
      const quantity = typeof quantityRaw === "number" ? quantityRaw : 1
      const discountRaw = discountField ? row[discountField.key] : undefined
      const discountPercent = typeof discountRaw === "number" ? discountRaw : 0
      const minor = Math.round(
        toMinor(unitPriceRaw, currency || "EUR") * quantity * (1 - discountPercent / 100),
      )
      subtotal = formatTotal(minor, currency || "")
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4" data-cy={`document-field-${arrayFieldKey}-row-${index}`}>
      {prefillSlot && <div className="flex justify-end">{prefillSlot}</div>}
      {/* Column on mobile so the designation gets the FULL row width instead of sharing it with the
          subtotal/remove cluster (that pairing squeezed the one field a user actually reads down to
          about half the screen) — back to one row at `sm:` and up, unchanged from before. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        {headField && (
          <div className="w-full sm:min-w-0 sm:flex-1">
            <DocumentField
              field={headField}
              name={`${rowPath}.${headField.key}`}
              documentTypeId={documentTypeId}
            />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 sm:mt-1 sm:shrink-0">
          {subtotal && (
            <span
              className="font-mono tabular-nums text-sm font-medium text-foreground"
              data-cy={`document-field-${arrayFieldKey}-row-${index}-subtotal`}
            >
              {subtotal}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={onRemove}
            tooltip={removeLabel}
            dataCy={`document-field-${arrayFieldKey}-remove-row-${index}`}
            aria-label={removeLabel}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-3">
        {restFields.map((rowField) => (
          <DocumentField
            key={rowField.key}
            field={rowField}
            name={`${rowPath}.${rowField.key}`}
            documentTypeId={documentTypeId}
          />
        ))}
      </div>
    </div>
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
    <div className="space-y-3" data-cy={`document-field-${field.key}`}>
      {/* Bumped past the plain field-label size — this is the one array field a document form
          reliably has (lines), and at 390px it reads as the form's own "section", not just another
          field, now that each row is its own card rather than a dense inline grid. */}
      <Label className="text-base font-semibold">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>
      {field.helpText && <p className="text-sm text-muted-foreground">{field.helpText}</p>}

      <div className="space-y-4 sm:space-y-3">
        {rows.map((row, index) => (
          <LineRowCard
            key={row.id}
            arrayFieldKey={field.key}
            name={name}
            index={index}
            rowFields={rowFields}
            documentTypeId={documentTypeId}
            onRemove={() => remove(index)}
            removeLabel={t("documents.form.array.removeRow")}
            prefillSlot={
              field.prefillFrom && (
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
              )
            }
          />
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

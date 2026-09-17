import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { getReferenceCreateComponent } from "@/components/documents/reference-create-registry"
import { isMultiTargetReference, type MultiTargetReferenceValue } from "@/components/documents/types"
import SearchSelect from "@/components/search-input"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  useDocumentTypesList,
  useMultiEntityReferenceSearch,
  useReferenceResolve,
  useReferenceSearch,
} from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

/** Packs `{ entity, id }` into the single string SearchSelect (a generic, entity-agnostic picker)
 *  works with, and back. "::" can't appear in a cuid, but even if some future id contained it,
 *  splitting on the FIRST occurrence is enough since `entity` is a registry key, never free text. */
function encodeRef(entity: string, id: string): string {
  return `${entity}::${id}`
}
function decodeRef(value: string): MultiTargetReferenceValue | undefined {
  const separator = value.indexOf("::")
  if (separator < 0) return undefined
  return { entity: value.slice(0, separator), id: value.slice(separator + 2) }
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value
}

/**
 * The one field kind that talks to the backend while the form is open: it never knows what
 * "client" (or any other `field.entity`/`field.entities`) means, only that
 * `/api/documents/references/:entity/...` resolves and searches values for it — the same generic
 * contract any future entity plugs into.
 *
 * MULTI-TARGET (`field.entities`, e.g. an invoice's "origin": quote OR invoice) fans the search out
 * to every allowed entity (useMultiEntityReferenceSearch) and shows, next to each result, WHICH
 * entity it came from — resolved through `useDocumentTypesList` for a human label ("Quote", not
 * "quote"), falling back to the raw entity name for one that isn't a document type at all. The
 * react-hook-form value for a multi-target field is `{ entity, id }` (see types.ts), which this
 * component packs into a single string for SearchSelect (a generic picker that only knows strings)
 * and unpacks on selection — SearchSelect itself never changes to know about this.
 *
 * SINGLE-target (`field.entity`) is completely unchanged from before `entities` existed: a bare id
 * string, one search, one resolve.
 *
 * SINGLE-target ALSO, optionally, carries a "+ Create new…" escape hatch: `reference-create-
 * registry.ts` (an open registry keyed by `entity`, same shape as `field-renderers/registry.ts`'s
 * for KINDS) is consulted for `singleEntity`; a hit renders as `SearchSelect`'s own `footerAction`
 * (always visible, even with zero search results) and, on click, mounts the registered dialog ON TOP
 * of whatever wizard this field is already inside — never closing or resetting it, since that dialog
 * is a sibling in the tree, not a replacement for this one. Multi-target never offers this: it picks
 * between EXISTING documents (a quote or invoice), which "create new" cannot mean anything for.
 */
export function ReferenceField({ field, name }: FieldRendererProps) {
  const { t } = useTranslation()
  const { control, watch } = useFormContext()
  const [search, setSearch] = useState("")
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const multiTarget = isMultiTargetReference(field)
  const targetEntities = field.entities ?? []
  const currentValue = watch(name) as string | MultiTargetReferenceValue | undefined

  // Single-target path — untouched behaviour.
  const singleEntity = multiTarget ? undefined : field.entity
  const QuickCreateComponent = singleEntity ? getReferenceCreateComponent(singleEntity) : undefined
  const inputDataCy = `document-field-${field.key}-input`
  const { data: singleSearchResults = [] } = useReferenceSearch(singleEntity, search)
  const { data: singleResolved } = useReferenceResolve(
    singleEntity,
    !multiTarget && typeof currentValue === "string" ? currentValue : undefined,
  )

  // Multi-target path — one search per allowed entity, merged and tagged with its source.
  const multiValue =
    multiTarget && currentValue && typeof currentValue === "object"
      ? (currentValue as MultiTargetReferenceValue)
      : undefined
  const { data: multiSearchResults } = useMultiEntityReferenceSearch(
    multiTarget ? targetEntities : [],
    search,
  )
  const { data: multiResolved } = useReferenceResolve(multiValue?.entity, multiValue?.id)
  // Only fetched to turn an entity id ("quote") into its human label ("Quote") in the picker — the
  // field never assumes its targets ARE document types, it just prefers that label when one exists.
  const { data: documentTypes } = useDocumentTypesList()
  const labelForEntity = (entity: string) =>
    documentTypes?.find((typeSummary) => typeSummary.id === entity)?.label ?? capitalize(entity)

  const options = multiTarget
    ? multiSearchResults.map((hit) => ({
        value: encodeRef(hit.entity, hit.id),
        label: `${labelForEntity(hit.entity)} — ${hit.label}`,
      }))
    : singleSearchResults.map((option) => ({ value: option.id, label: option.label }))

  const allOptions = multiTarget
    ? multiValue && multiResolved
      ? [
          {
            value: encodeRef(multiValue.entity, multiValue.id),
            label: `${labelForEntity(multiValue.entity)} — ${multiResolved.label}`,
          },
        ]
      : []
    : singleResolved
      ? [{ value: singleResolved.id, label: singleResolved.label }]
      : []

  const selectValue = multiTarget
    ? multiValue
      ? encodeRef(multiValue.entity, multiValue.id)
      : ""
    : ((currentValue as string) ?? "")

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FormItem data-cy={`document-field-${field.key}`}>
          <FormLabel required={field.required}>{field.label}</FormLabel>
          <FormControl>
            <SearchSelect
              options={options}
              allOptions={allOptions}
              value={selectValue}
              onValueChange={(value) => {
                const raw = value as string
                if (!multiTarget) {
                  rhfField.onChange(raw)
                  return
                }
                const decoded = raw ? decodeRef(raw) : undefined
                rhfField.onChange(decoded)
              }}
              onSearchChange={setSearch}
              placeholder={field.label}
              searchPlaceholder={t("documents.form.reference.searchPlaceholder")}
              noResultsText={t("documents.form.reference.noResults")}
              data-cy={inputDataCy}
              footerAction={
                QuickCreateComponent
                  ? {
                      label: t("documents.form.reference.createNew", "+ Create new {{label}}", {
                        label: field.label,
                      }),
                      onClick: () => setQuickCreateOpen(true),
                      "data-cy": `${inputDataCy}-create-new`,
                    }
                  : undefined
              }
            />
          </FormControl>
          {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
          <FormMessage />

          {QuickCreateComponent && (
            <QuickCreateComponent
              open={quickCreateOpen}
              onOpenChange={(next) => {
                setQuickCreateOpen(next)
                if (!next) {
                  // Two Radix Dialogs stacked (this quick-create one over whatever wizard the field
                  // itself is inside): Radix's own close-focus restore would try to refocus the "+
                  // Create new…" button — it lived inside the SearchSelect popover THIS SAME CLICK
                  // already closed, so by the time this dialog unmounts that button is long gone and
                  // focus is lost rather than restored. `requestAnimationFrame` waits one paint past
                  // that failed default before explicitly handing focus back to the picker's own
                  // trigger, found by the exact `data-cy` its wrapper already carries.
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLButtonElement>(`[data-cy="${inputDataCy}"] button`)?.focus()
                  })
                }
              }}
              onCreated={(id) => {
                // Single-target only (the one shape `QuickCreateComponent` can ever be non-undefined
                // for — see this component's own header) — the bare id `rhfField.onChange` already
                // takes on every other selection here, letting `useReferenceResolve` above pick up its
                // label the same way it would for a value set any other way.
                rhfField.onChange(id)
              }}
            />
          )}
        </FormItem>
      )}
    />
  )
}

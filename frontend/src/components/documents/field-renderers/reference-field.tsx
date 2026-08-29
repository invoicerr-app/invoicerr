import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

import SearchSelect from "@/components/search-input"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useReferenceResolve, useReferenceSearch } from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

/**
 * The one field kind that talks to the backend while the form is open: it never knows what
 * "client" (or any other `field.entity`) means, only that `/api/documents/references/:entity/...`
 * resolves and searches values for it — the same generic contract any future entity plugs into.
 */
export function ReferenceField({ field, name }: FieldRendererProps) {
  const { t } = useTranslation()
  const { control, watch } = useFormContext()
  const [search, setSearch] = useState("")

  const currentValue = watch(name)
  const { data: searchResults = [] } = useReferenceSearch(field.entity, search)
  // Keeps the currently-selected option's label visible even after the user has typed a different
  // search query that no longer contains it — e.g. re-opening a saved draft, where only the id is
  // known until this resolves.
  const { data: resolved } = useReferenceResolve(
    field.entity,
    typeof currentValue === "string" ? currentValue : undefined,
  )
  const allOptions = resolved ? [{ value: resolved.id, label: resolved.label }] : []

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FormItem data-cy={`document-field-${field.key}`}>
          <FormLabel required={field.required}>{field.label}</FormLabel>
          <FormControl>
            <SearchSelect
              options={searchResults.map((o) => ({ value: o.id, label: o.label }))}
              allOptions={allOptions}
              value={rhfField.value ?? ""}
              onValueChange={(value) => rhfField.onChange(value)}
              onSearchChange={setSearch}
              placeholder={field.label}
              searchPlaceholder={t("documents.form.reference.searchPlaceholder")}
              noResultsText={t("documents.form.reference.noResults")}
              data-cy={`document-field-${field.key}-input`}
            />
          </FormControl>
          {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

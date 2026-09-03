import { useEffect, useState } from "react"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { BetterInput } from "@/components/better-input"
import { DatePicker } from "@/components/date-picker"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import SearchSelect from "@/components/search-input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useReferenceFields } from "@/hooks/queries"

import type { FieldRendererProps } from "./registry"

function FieldChrome({
  field,
  children,
  note,
}: Pick<FieldRendererProps, "field"> & { children: React.ReactNode; note?: string }) {
  return (
    <FormItem data-cy={`document-field-${field.key}`}>
      <FormLabel required={field.required}>{field.label}</FormLabel>
      <FormControl>{children}</FormControl>
      {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
      {/* TODO_PRODUIT.md T4-d — the ONLY caller today is SelectField's own `lockedFromReference`
          note, kept generic (a plain optional prop, not a `field.lockedFromReference` check inside
          FieldChrome itself) the same way `helpText` above is generic across every field kind. */}
      {note && <FormDescription data-cy={`document-field-${field.key}-note`}>{note}</FormDescription>}
      <FormMessage />
    </FormItem>
  )
}

export function TextField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <BetterInput
            {...rhfField}
            value={rhfField.value ?? ""}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function LongTextField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <Textarea
            {...rhfField}
            value={rhfField.value ?? ""}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function NumberField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <BetterInput
            {...rhfField}
            type="number"
            min={field.min}
            max={field.max}
            step="any"
            value={rhfField.value ?? ""}
            onChange={(e) => rhfField.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function MoneyField({ field, name }: FieldRendererProps) {
  const { control, watch } = useFormContext()
  const currency = field.currencyField ? watch(field.currencyField) : field.currency

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <BetterInput
            {...rhfField}
            type="number"
            min={field.min}
            max={field.max}
            step="0.01"
            value={rhfField.value ?? ""}
            onChange={(e) => rhfField.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            postAdornment={currency || undefined}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function DateField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <DatePicker
            className="w-full"
            value={rhfField.value ? new Date(rhfField.value) : null}
            onChange={(date) => rhfField.onChange(date ? date.toISOString() : undefined)}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function BooleanField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FormItem
          data-cy={`document-field-${field.key}`}
          className="flex flex-row items-center justify-between rounded-md border p-3"
        >
          <FormLabel required={field.required}>{field.label}</FormLabel>
          <FormControl>
            <Switch
              checked={!!rhfField.value}
              onCheckedChange={rhfField.onChange}
              data-cy={`document-field-${field.key}-input`}
            />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

export function SelectField({ field, name }: FieldRendererProps) {
  const { t } = useTranslation()
  const { control, watch, setValue } = useFormContext()
  const allOptions = field.options ?? []
  const [search, setSearch] = useState("")

  // TODO_PRODUIT.md T4-d — `lockedFromReference` (types.ts): watch the named SIBLING 'reference'
  // field (e.g. a credit note's own "invoice"), and once it resolves to a real id, copy
  // `sourceKey` off that entity's raw fields (the SAME `getFields` mechanism `prefillFrom`,
  // array-field.tsx, already calls) onto THIS field — kept in sync for as long as the reference
  // stays set, disabled so the user never types a value that could silently disagree with it. No
  // reference picked yet (a brand-new record) leaves this field a normal, editable select — the
  // lock only ever engages once there is something concrete to follow.
  const lockedFrom = field.lockedFromReference
  const referenceValue = lockedFrom ? watch(lockedFrom.field) : undefined
  const referenceId = lockedFrom && typeof referenceValue === "string" ? referenceValue : undefined
  const { data: lockedFields } = useReferenceFields(lockedFrom?.entity, referenceId)
  const lockedValue =
    lockedFrom && referenceId && lockedFields && typeof lockedFields[lockedFrom.sourceKey] !== "undefined"
      ? String(lockedFields[lockedFrom.sourceKey])
      : undefined

  useEffect(() => {
    if (lockedValue === undefined) return
    setValue(name, lockedValue, { shouldValidate: true, shouldDirty: true })
  }, [lockedValue, name, setValue])

  // No known list AT ALL (e.g. no VAT rate catalog for this company's country — see the backend's
  // descriptors/company-view.ts, which is what would have filled `options` here) — a dropdown with
  // zero choices is a dead control, not an honest escape hatch. `field.helpText` already explains
  // why (the backend sets it for exactly this case), and `allowCustomValue` is what says this
  // particular field is allowed to degrade this way at all — a select whose emptiness would be a
  // BUG (e.g. currency) never declares it, and keeps showing the (empty, clearly wrong) list below
  // instead of silently accepting anything.
  if (allOptions.length === 0 && field.allowCustomValue) {
    return (
      <FormField
        control={control}
        name={name}
        render={({ field: rhfField }) => (
          <FieldChrome field={field}>
            <BetterInput
              {...rhfField}
              value={rhfField.value ?? ""}
              data-cy={`document-field-${field.key}-input`}
            />
          </FieldChrome>
        )}
      />
    )
  }

  // SearchSelect renders exactly the `options` it's given — filtering as the user types is this
  // kind's own job, same as ReferenceField filters by asking the backend instead.
  const filtered = search
    ? allOptions.filter(
        (option) =>
          option.label.toLowerCase().includes(search.toLowerCase()) ||
          option.value.toLowerCase().includes(search.toLowerCase()),
      )
    : allOptions

  const isLocked = lockedValue !== undefined

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome
          field={field}
          note={isLocked ? t("documents.form.select.lockedFromReference") : undefined}
        >
          <SearchSelect
            options={filtered}
            allOptions={allOptions}
            value={rhfField.value ?? ""}
            onValueChange={(value) => rhfField.onChange(value)}
            onSearchChange={setSearch}
            placeholder={field.label}
            disabled={isLocked}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

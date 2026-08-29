import { useState } from "react"
import { useFormContext } from "react-hook-form"

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

import type { FieldRendererProps } from "./registry"

function FieldChrome({ field, children }: Pick<FieldRendererProps, "field"> & { children: React.ReactNode }) {
  return (
    <FormItem data-cy={`document-field-${field.key}`}>
      <FormLabel required={field.required}>{field.label}</FormLabel>
      <FormControl>{children}</FormControl>
      {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
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
  const { control } = useFormContext()
  const allOptions = field.options ?? []
  const [search, setSearch] = useState("")

  // SearchSelect renders exactly the `options` it's given — filtering as the user types is this
  // kind's own job, same as ReferenceField filters by asking the backend instead.
  const filtered = search
    ? allOptions.filter(
        (option) =>
          option.label.toLowerCase().includes(search.toLowerCase()) ||
          option.value.toLowerCase().includes(search.toLowerCase()),
      )
    : allOptions

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field}>
          <SearchSelect
            options={filtered}
            allOptions={allOptions}
            value={rhfField.value ?? ""}
            onValueChange={(value) => rhfField.onChange(value)}
            onSearchChange={setSearch}
            placeholder={field.label}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

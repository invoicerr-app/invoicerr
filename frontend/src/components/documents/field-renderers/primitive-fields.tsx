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
import { fromCalendarDate, toCalendarDate } from "@/lib/calendar-date"

import type { FieldRendererProps } from "./registry"

function FieldChrome({
  field,
  children,
  note,
  required,
}: Pick<FieldRendererProps, "field"> & { children: React.ReactNode; note?: string; required?: boolean }) {
  return (
    <FormItem data-cy={`document-field-${field.key}`}>
      <FormLabel required={required ?? field.required}>{field.label}</FormLabel>
      <FormControl>{children}</FormControl>
      {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
      {/* The ONLY caller today is SelectField's own `lockedFromReference`
          note, kept generic (a plain optional prop, not a `field.lockedFromReference` check inside
          FieldChrome itself) the same way `helpText` above is generic across every field kind. */}
      {note && <FormDescription data-cy={`document-field-${field.key}-note`}>{note}</FormDescription>}
      <FormMessage />
    </FormItem>
  )
}

function isPresentValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value != null
}

/**
 * `SearchSelect`'s trigger looks a stored value's label up in `allOptions` (search-input.tsx's own
 * `getOptionLabel`) — but `field.options` alone can't name a value a document persisted under
 * `legacyOptions` (types.ts's own header: the VAT-rate catalog migration, a bare percentage like "20"
 * before `options` switched to catalog ids). Without this, an old document's trigger renders blank —
 * the value IS accepted (field-kinds.ts's validator, schema.ts's zod mirror both check `legacyOptions`
 * too), it simply has no label to show. Resolved to the CURRENT catalog's own label (`options[i]`,
 * same index `legacyOptions[i]` came from — both built together, vat-rates/registry.ts), never
 * `legacyOptions[i].label` itself, so an old document reads exactly like a freshly picked one.
 */
export function legacyOptionLabels(field: FieldRendererProps["field"]): { value: string; label: string }[] {
  const legacyOptions = field.legacyOptions ?? []
  const options = field.options ?? []
  return legacyOptions
    .map((legacy, index) => (options[index] ? { value: legacy.value, label: options[index].label } : null))
    .filter((option): option is { value: string; label: string } => option !== null)
}

/** `requiredIfPresent` (DocumentFieldDescriptor, backend types.ts): this field is required only once
 *  a named SIBLING field is itself set — e.g. a Polish correction invoice's own `correctionReason`,
 *  required the moment `correctsInvoiceId` resolves (country-fields/data/pl.json). Watches a dummy,
 *  never-real field name when the hint is absent so the `watch()` call itself stays unconditional
 *  (react-hook-form's own hook-order requirement) without ever subscribing to the WHOLE form the way
 *  `watch()` with no argument at all would. This is a SCREEN convenience only — the backend's own
 *  `descriptors/validate.ts#validateAgainstDescriptor` (which every action already runs against, per
 *  `documents.service.ts#runAction`) is what actually enforces it, the same "never trusted alone"
 *  split every other conditional guard in this module already holds. */
export function useConditionallyRequired(field: FieldRendererProps["field"]): boolean {
  const { watch } = useFormContext()
  const siblingValue = watch(field.requiredIfPresent || "__requiredIfPresent_unset__")
  // `requiredIfAbsent` (types.ts) — the mirror image, watched the same dummy-field-name way so this
  // hook's own call order never depends on which hint (if either) a given field actually declares.
  const absentSiblingValue = watch(field.requiredIfAbsent || "__requiredIfAbsent_unset__")
  if (field.required) return true
  if (field.requiredIfPresent) return isPresentValue(siblingValue)
  if (field.requiredIfAbsent) return !isPresentValue(absentSiblingValue)
  return false
}

export function TextField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  const required = useConditionallyRequired(field)
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field} required={required}>
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
  const required = useConditionallyRequired(field)
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field} required={required}>
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

/** A `kind: 'date'` field stores a CALENDAR DAY, not an instant — `lib/calendar-date.ts` carries the
 *  whole rule and why it is load-bearing here of all places: this is the renderer behind every
 *  document date the backend reads as law (an invoice's `issueDate` and `dueDate`, a credit note's
 *  `issueDate`, a purchase order's `expectedDeliveryDate`, an expense's `date`), and it used to hand
 *  `toISOString()` a `Date` the calendar had built at LOCAL midnight — which is the previous UTC day
 *  everywhere east of Greenwich, i.e. in all five countries this product targets. */
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
            value={fromCalendarDate(rhfField.value)}
            onChange={(date) => rhfField.onChange(toCalendarDate(date))}
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

  // `lockedFromReference` (types.ts): watch the named SIBLING 'reference'
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

  // Label lookup ONLY (search-input.tsx's own `allOptions` prop) — the dropdown itself still lists
  // `filtered`/`allOptions` above, never these: `legacyOptions` must never be OFFERED as a choice,
  // only recognized when a value already persisted under it comes back around (legacyOptionLabels's
  // own header).
  const labelOptions = [...allOptions, ...legacyOptionLabels(field)]

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
            allOptions={labelOptions}
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

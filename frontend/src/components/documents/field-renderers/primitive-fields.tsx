import { useEffect, useState } from "react"
import { useFormContext, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { BetterInput } from "@/components/better-input"
import { DatePicker } from "@/components/date-picker"
import { useDocumentFormReadOnly } from "@/components/documents/document-form-readonly"
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
 *  required the moment `correctsInvoiceId` resolves (countries/data/pl.json (section "countryFields")). Watches a dummy,
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

/**
 * `name` for a ROW-nested field is `${arrayFieldKey}.${rowIndex}.${subFieldKey}` (registry.ts's own
 * doc comment on `FieldRendererProps.name`) - e.g. "lines.2.option". Splitting off the last TWO
 * segments (never assuming which array/subfield by name) is what lets `SiblingSuggestionsDatalist` below
 * work for ANY text subfield on ANY array row, not just the quote's own `option` field: a generic
 * convenience, not a per-field special case, the same discipline this whole field-renderer registry
 * already holds. `undefined` for a top-level (non-row) field, where there are no "sibling rows" to
 * suggest from at all.
 */
export function arrayRowFieldPath(name: string): { arrayFieldName: string; subFieldKey: string } | undefined {
  const parts = name.split(".")
  if (parts.length < 3) return undefined
  const rowIndex = parts[parts.length - 2]
  if (!/^\d+$/.test(rowIndex)) return undefined
  return { arrayFieldName: parts.slice(0, -2).join("."), subFieldKey: parts[parts.length - 1] }
}

/**
 * Issue #373's own editor-convenience ask: suggestions of values ALREADY typed for this SAME
 * subfield on OTHER rows of the SAME array - a plain HTML5 `<datalist>`, so typing "Basic" on one
 * quote line offers it back while typing the next line's own `option`. The mechanism itself is
 * generic (any array, any 'text' subfield) - but it is gated on the field's own
 * `suggestSiblingValues` opt-in (types.ts's own header on that flag): without it, this would change
 * every OTHER array text subfield of every OTHER document type too (an invoice's own line
 * `description` starting to suggest sibling designations, unrequested), which is exactly what this
 * flag exists to prevent. `undefined` when the field did not opt in, or outside an array row
 * entirely (nothing to suggest from) - either way, a field renders exactly as it always did.
 *
 * Issue #479: this used to be a hook that called `useWatch` on the WHOLE array before checking the
 * opt-in, so every text field of every row (an invoice line's `description` included) re-rendered on
 * every keystroke anywhere in that array. The subscription now lives in `SiblingSuggestionsDatalist`
 * below, which is only MOUNTED for a field that opted in - hooks cannot be called conditionally, a
 * component can be rendered conditionally, and the field itself never subscribes to its siblings.
 */
function siblingSuggestionsPath(
  field: FieldRendererProps["field"],
  name: string,
): { arrayFieldName: string; subFieldKey: string } | undefined {
  if (!field.suggestSiblingValues) return undefined
  return arrayRowFieldPath(name)
}

function SiblingSuggestionsDatalist({
  id,
  arrayFieldName,
  subFieldKey,
}: {
  id: string
  arrayFieldName: string
  subFieldKey: string
}) {
  const rows = useWatch({ name: arrayFieldName }) as Record<string, unknown>[] | undefined
  if (!Array.isArray(rows)) return null
  const seen = new Set<string>()
  const suggestions: string[] = []
  for (const row of rows) {
    const raw = row?.[subFieldKey]
    const trimmed = typeof raw === "string" ? raw.trim() : ""
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    suggestions.push(trimmed)
  }
  if (suggestions.length === 0) return null
  return (
    <datalist id={id}>
      {suggestions.map((suggestion) => (
        <option key={suggestion} value={suggestion} />
      ))}
    </datalist>
  )
}

/** The typed text of a field with fixed `suggestedValues` is shown as the entry's label and stored as its
 *  value: picking "Day" or typing it stores the code, any other text is stored as typed. */
function suggestedValueOf(field: FieldRendererProps["field"], typed: string): string {
  const wanted = typed.trim().toLowerCase()
  return field.suggestedValues?.find((entry) => entry.label.toLowerCase() === wanted)?.value ?? typed
}

function suggestedLabelOf(field: FieldRendererProps["field"], stored: string): string {
  return field.suggestedValues?.find((entry) => entry.value === stored)?.label ?? stored
}

export function TextField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  const required = useConditionallyRequired(field)
  const readOnly = useDocumentFormReadOnly()
  const suggestionsPath = siblingSuggestionsPath(field, name)
  const fixedListId = field.suggestedValues ? `${name.replace(/\./g, "-")}-suggested` : undefined
  // A stable, collision-safe id: `name` itself is already unique per field instance (react-hook-form
  // never reuses one), just not a valid HTML id verbatim (dots).
  const datalistId = suggestionsPath ? `${name.replace(/\./g, "-")}-suggestions` : undefined
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <>
          {/* `FieldChrome`'s own `<FormControl>` is a Radix `Slot` - it clones its props onto
              EXACTLY ONE child element, so the `<datalist>` must render as a SIBLING here, never a
              second child alongside `<BetterInput>` inside `FieldChrome` (that would break Slot's
              single-child invariant). A `<datalist>` is invisible either way - only `list={id}` on
              the input itself matters for the browser to find it. */}
          <FieldChrome field={field} required={required}>
            <BetterInput
              {...rhfField}
              value={suggestedLabelOf(field, rhfField.value ?? "")}
              onChange={(event) => rhfField.onChange(suggestedValueOf(field, event.target.value))}
              disabled={readOnly}
              list={datalistId ?? fixedListId}
              data-cy={`document-field-${field.key}-input`}
            />
          </FieldChrome>
          {fixedListId && field.suggestedValues && (
            <datalist id={fixedListId}>
              {field.suggestedValues.map((entry) => (
                <option key={entry.value} value={entry.label} />
              ))}
            </datalist>
          )}
          {datalistId && suggestionsPath && (
            <SiblingSuggestionsDatalist
              id={datalistId}
              arrayFieldName={suggestionsPath.arrayFieldName}
              subFieldKey={suggestionsPath.subFieldKey}
            />
          )}
        </>
      )}
    />
  )
}

export function LongTextField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  const required = useConditionallyRequired(field)
  const readOnly = useDocumentFormReadOnly()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field: rhfField }) => (
        <FieldChrome field={field} required={required}>
          <Textarea
            {...rhfField}
            value={rhfField.value ?? ""}
            disabled={readOnly}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function NumberField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  const readOnly = useDocumentFormReadOnly()
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
            disabled={readOnly}
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
  const readOnly = useDocumentFormReadOnly()

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
            disabled={readOnly}
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
  const readOnly = useDocumentFormReadOnly()
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
            disabled={readOnly}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

export function BooleanField({ field, name }: FieldRendererProps) {
  const { control } = useFormContext()
  const readOnly = useDocumentFormReadOnly()
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
              disabled={readOnly}
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
  const readOnly = useDocumentFormReadOnly()

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
              disabled={readOnly}
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
            disabled={isLocked || readOnly}
            data-cy={`document-field-${field.key}-input`}
          />
        </FieldChrome>
      )}
    />
  )
}

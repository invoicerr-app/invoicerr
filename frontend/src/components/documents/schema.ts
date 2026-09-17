import { z } from "zod"

import type { DocumentFieldDescriptor } from "./types"

/**
 * Turns a descriptor's fields into a zod schema, purely for immediate in-form feedback — the
 * backend's validateAgainstDescriptor (documents/descriptors/validate.ts) is the one authority on
 * whether data is actually accepted, and every submit still goes through it. An unrecognized field
 * kind gets `z.any()` here (nothing to check client-side for it) but is still visibly unsupported in
 * the UI via DocumentField's fallback.
 */
function baseSchemaFor(field: DocumentFieldDescriptor): z.ZodTypeAny {
  switch (field.kind) {
    case "text":
    case "longText":
    case "date":
      return z.string()
    case "select": {
      const values = (field.options ?? []).map((o) => o.value)
      // `legacyOptions` (types.ts's own header) is never OFFERED as a choice, but a value already
      // persisted under it must still round-trip through this form without tripping client-side
      // validation the instant the record is reopened — e.g. a VAT-rate line saved back when
      // `options` still held bare percentages ("20") instead of today's catalog ids ("it-standard").
      const legacyValues = (field.legacyOptions ?? []).map((o) => o.value)
      // Mirrors the backend's field-kinds.ts 'select' validator exactly: an empty list always
      // accepts any non-empty string (there is nothing to check client-side, and — if
      // `allowCustomValue` isn't even set — this is also the pre-existing, unrelated "no options
      // configured" tolerance this schema already had); a NON-empty list is enforced regardless of
      // `allowCustomValue`, which only ever opens the escape hatch for an EMPTY list — `legacyOptions`
      // is a THIRD, independent way in, not gated on `allowCustomValue` either, same as the backend.
      return values.length > 0
        ? z.string().refine((v) => values.includes(v) || legacyValues.includes(v))
        : z.string()
    }
    case "reference":
      // Multi-target (`entities`): the stored value is `{ entity, id }`, not a bare id — see
      // types.ts's `isMultiTargetReference`. Single-target (`entity`): unchanged, a bare id string.
      return field.entities?.length
        ? z.object({ entity: z.string().min(1), id: z.string().min(1) })
        : z.string()
    case "hiddenReference":
      // Always single-target, always optional (see types.ts's own `entity` doc comment) — the same
      // bare id string as single-target 'reference' above. Client-side shape only: nothing renders a
      // control for this kind (field-renderers/hidden-reference-field.tsx), so there is no form input
      // for this schema to ever reject; the backend's own 'hiddenReference' validator
      // (field-kinds.ts) is what actually enforces it on save.
      return z.string()
    case "file":
      // Mirrors the backend's own 'file' validator (field-kinds.ts) exactly — a well-shaped
      // `{ fileRef, fileName, mime }`, never the bytes themselves. Existence-on-disk is checked by
      // neither side (see that validator's own comment).
      return z.object({
        fileRef: z.string().min(1),
        fileName: z.string().min(1),
        mime: z.string().min(1),
      })
    case "number":
    case "money": {
      let schema = z.number()
      if (field.min !== undefined) schema = schema.min(field.min)
      if (field.max !== undefined) schema = schema.max(field.max)
      return schema
    }
    case "boolean":
      return z.boolean()
    case "array": {
      let schema = z.array(buildZodSchema(field.fields ?? []))
      if (field.min !== undefined) schema = schema.min(field.min)
      if (field.max !== undefined) schema = schema.max(field.max)
      return schema
    }
    case "rowSelection": {
      // Shape only, like 'array' above — whether each selected id still exists on the referenced
      // source is checked live by the renderer (row-selection-field.tsx) and, authoritatively, by
      // the backend on save (validateRowSelections); this client-side schema cannot know that.
      let schema = z.array(z.string())
      if (field.min !== undefined) schema = schema.min(field.min)
      if (field.max !== undefined) schema = schema.max(field.max)
      return schema
    }
    default:
      return z.any()
  }
}

function isPresentValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value != null
}

export function buildZodSchema(fields: DocumentFieldDescriptor[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  // `requiredIfPresent` (types.ts) can't be expressed on a single field's own schema — it depends on
  // a SIBLING field's value — so it's collected here and enforced by ONE `superRefine` on the whole
  // object below, the same "one extra pass over the shape" approach every zod conditional-field
  // recipe uses. Mirrors the backend's own `validateAgainstDescriptor#isRequiredFor` exactly (same
  // predicate, same message shape) — this is client-side, in-form feedback ONLY; the backend is still
  // the one authority (this file's own header).
  const conditionallyRequired: { key: string; label: string; requiredIfPresent: string }[] = []

  for (const field of fields) {
    const schema = baseSchemaFor(field)
    shape[field.key] = field.required ? schema : schema.optional().nullable()
    if (field.requiredIfPresent) {
      conditionallyRequired.push({
        key: field.key,
        label: field.label,
        requiredIfPresent: field.requiredIfPresent,
      })
    }
  }

  const base = z.object(shape)
  if (conditionallyRequired.length === 0) return base

  return base.superRefine((data, ctx) => {
    const record = data as Record<string, unknown>
    for (const { key, label, requiredIfPresent } of conditionallyRequired) {
      if (!isPresentValue(record[requiredIfPresent])) continue
      if (isPresentValue(record[key])) continue
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `"${label}" is required.` })
    }
  })
}

export function defaultValuesFor(fields: DocumentFieldDescriptor[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.kind === "array" || field.kind === "rowSelection") defaults[field.key] = []
    else if (field.kind === "boolean") defaults[field.key] = false
    else defaults[field.key] = undefined
  }
  return defaults
}

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
      return values.length > 0 ? z.string().refine((v) => values.includes(v)) : z.string()
    }
    case "reference":
      // Multi-target (`entities`): the stored value is `{ entity, id }`, not a bare id — see
      // types.ts's `isMultiTargetReference`. Single-target (`entity`): unchanged, a bare id string.
      return field.entities?.length
        ? z.object({ entity: z.string().min(1), id: z.string().min(1) })
        : z.string()
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

export function buildZodSchema(fields: DocumentFieldDescriptor[]) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const field of fields) {
    const schema = baseSchemaFor(field)
    shape[field.key] = field.required ? schema : schema.optional().nullable()
  }

  return z.object(shape)
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

import type { DocumentFieldDescriptor, DocumentTypeDescriptor } from "./types"

/**
 * Detects whether a descriptor has array fields with "line" shape (has both 'money' and 'number' subfields).
 * Used to decide whether to show totals on the form. Mirrors compute-totals.ts's detection logic.
 */
export function hasLineArrayFields(descriptor: DocumentTypeDescriptor | undefined): boolean {
  if (!descriptor?.fields) return false

  for (const field of descriptor.fields) {
    if (field.kind !== "array" || !field.fields) continue

    const hasMoney = field.fields.some((f) => f.kind === "money")
    const hasNumber = field.fields.some((f) => f.kind === "number")

    if (hasMoney && hasNumber) {
      return true
    }
  }

  return false
}

/**
 * Extracts the currency value from document data.
 * Looks for a top-level field (kind 'select' or 'text') whose key contains 'currency' (case-insensitive).
 */
export function extractCurrency(
  descriptor: DocumentTypeDescriptor | undefined,
  data: Record<string, unknown>,
): string | null {
  if (!descriptor?.fields) return null

  for (const field of descriptor.fields) {
    if ((field.kind === "select" || field.kind === "text") && field.key.toLowerCase().includes("currency")) {
      const value = data[field.key]
      if (typeof value === "string" && value) {
        return value
      }
    }
  }

  return null
}

/**
 * Finds all array fields that have both 'money' and 'number' subfields.
 * Mirrors compute-totals.ts's detection logic.
 */
export function findLineArrayFields(
  descriptor: DocumentTypeDescriptor | undefined,
): DocumentFieldDescriptor[] {
  if (!descriptor?.fields) return []

  const result: DocumentFieldDescriptor[] = []

  for (const field of descriptor.fields) {
    if (field.kind !== "array" || !field.fields) continue

    const hasMoney = field.fields.some((f) => f.kind === "money")
    const hasNumber = field.fields.some((f) => f.kind === "number")

    if (hasMoney && hasNumber) {
      result.push(field)
    }
  }

  return result
}

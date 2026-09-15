/**
 * "Does the form differ from what is saved?" — answered by comparing VALUES, never by
 * react-hook-form's own `formState.isDirty`. Verified live on the detail page: after
 * `form.reset(savedData)` RHF's `_getDirty()` flips back to `true` although both sides serialize
 * identically, because a mounted input registers its key into the live values with `undefined`
 * (an empty optional "notes", an untouched line `discountPercent`) while the saved data simply has
 * no such key — and RHF's structural `deepEqual` counts keys. The "Unsaved changes" bar then never
 * went away after a successful save.
 *
 * Emptiness is one thing here: a missing key, `undefined`, `null` and `""` all mean "nothing
 * entered", so clearing a field that was never filled is not a change either. Keys are sorted so
 * the order a renderer happens to register them in never counts as a difference.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalize((value as Record<string, unknown>)[key])
      if (normalized !== undefined) out[key] = normalized
    }
    return out
  }
  if (value === null || value === "") return undefined
  return value
}

export function hasUnsavedChanges(values: unknown, baseline: unknown): boolean {
  return JSON.stringify(normalize(values)) !== JSON.stringify(normalize(baseline))
}

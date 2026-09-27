import { useEffect, useState } from "react"
import type { FieldValues, UseFormReturn } from "react-hook-form"

import { hasUnsavedChanges } from "@/components/documents/form-dirty"

/**
 * "Does the form differ from `baseline`?" as a boolean that only changes when the ANSWER changes.
 *
 * Issue #488: the detail page used to get this from `useWatch({ control })` on the whole form, which
 * re-renders the calling component on every value change. That component is the page body, so every
 * keystroke re-rendered every field under it (measured: 10 characters typed in one line of a 5-line
 * invoice committed 110 text fields). Here the values are read from a `form.watch(callback)`
 * subscription instead, which runs the comparison without rendering anything, and the result goes
 * through `useState`: React bails out of a state update to the same value, so the host re-renders
 * only when the form goes from clean to dirty or back.
 *
 * Every path that can move the answer emits on the subscription: typing and `setValue` (including
 * the field arrays' own add/remove rows), and `form.reset(...)`, which is how both "Discard" and a
 * save (the host's new baseline flows back through `useDocumentForm`'s `initialData` reset) land.
 * The effect also recomputes on its own whenever `baseline` changes, so a new baseline is compared
 * against the values already in the form without waiting for the next keystroke.
 *
 * The comparison itself is still `hasUnsavedChanges` (form-dirty.ts), by value, never RHF's own
 * `formState.isDirty`: see that file for why.
 */
export function useUnsavedChanges<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  baseline: Record<string, unknown>,
): boolean {
  const [dirty, setDirty] = useState(() => hasUnsavedChanges(form.getValues(), baseline))

  useEffect(() => {
    const recompute = () => setDirty(hasUnsavedChanges(form.getValues(), baseline))
    recompute()
    const subscription = form.watch(recompute)
    return () => subscription.unsubscribe()
  }, [form, baseline])

  return dirty
}

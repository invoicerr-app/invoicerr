import { useEffect, useRef } from "react"
import type { FieldValues, UseFormReturn } from "react-hook-form"

import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { usePaymentTerms } from "@/hooks/queries/use-payment-terms"
import { computeDueDate } from "@/lib/due-date"

const isEmpty = (value: unknown) => value === undefined || value === null || value === ""

/**
 * Fills a NEW quote's or invoice's due date from the company's default terms as soon as the issue
 * date is known, and re-computes it when the issue date changes, until the user has set or cleared
 * the due date themselves. A record that already exists, or a form seeded with a due date, is never
 * touched.
 */
export function useDueDateDefault(
  form: UseFormReturn<FieldValues>,
  typeId: string,
  fields: DocumentFieldDescriptor[],
  documentId: string | undefined,
  seededDueDate: unknown,
) {
  const applicable =
    !documentId &&
    (typeId === "quote" || typeId === "invoice") &&
    fields.some((field) => field.key === "issueDate") &&
    fields.some((field) => field.key === "dueDate")
  const { data: terms } = usePaymentTerms(applicable)
  const term = applicable ? terms?.[typeId as "quote" | "invoice"] : undefined

  const lastAutoFilled = useRef<string | undefined>(undefined)
  const editedByHand = useRef(!isEmpty(seededDueDate))

  useEffect(() => {
    if (!term) return
    const apply = () => {
      if (editedByHand.current) return
      const due = computeDueDate(form.getValues("issueDate"), term)
      if (!due) return
      lastAutoFilled.current = due
      form.setValue("dueDate", due, { shouldDirty: true, shouldValidate: true })
    }
    apply()
    const subscription = form.watch((values, { name }) => {
      if (name === "issueDate") apply()
      else if (name === "dueDate" && values.dueDate !== lastAutoFilled.current) editedByHand.current = true
    })
    return () => subscription.unsubscribe()
  }, [form, term])
}

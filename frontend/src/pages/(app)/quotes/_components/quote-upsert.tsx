"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePatch, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import type { Quote } from "@/types"
import { QuoteFormFields, type QuoteFormValues, useQuoteForm } from "./quote-form"
import { queryKeys } from "@/lib/query-keys"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

interface QuoteUpsertDialogProps {
  quote?: Quote | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuoteUpsert({ quote, open, onOpenChange }: QuoteUpsertDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!quote
  const queryClient = useQueryClient()

  const saveErrorMessage = t("quotes.upsert.messages.saveError", "Failed to save quote")
  const { trigger: createTrigger, loading: createLoading } = useMutationWithToast(
    usePost("/api/quotes"),
    saveErrorMessage,
  )
  const { trigger: updateTrigger, loading: updateLoading } = useMutationWithToast(
    usePatch(`/api/quotes/${quote?.id}`),
    saveErrorMessage,
  )
  const submitLoading = isEdit ? updateLoading : createLoading

  const form = useQuoteForm(quote)

  const onSubmit = async (data: QuoteFormValues) => {
    const trigger = isEdit ? updateTrigger : createTrigger

    const result = await trigger(data)
    if (!result) return // failure already surfaced as a toast

    queryClient.invalidateQueries({ queryKey: queryKeys.quotes.listsAll() })
    onOpenChange(false)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm lg:max-w-4xl h-[85dvh] max-h-[85dvh] p-0 gap-0 flex flex-col overflow-hidden"
        dataCy="quote-dialog"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t(`quotes.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <QuoteFormFields form={form} formId="quote-form" onSubmit={onSubmit} />
        </div>

        <div className="shrink-0 border-t px-6 py-4 flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("quotes.upsert.actions.cancel")}
          </Button>
          <Button type="submit" form="quote-form" loading={submitLoading} dataCy="quote-submit">
            {t(`quotes.upsert.actions.${isEdit ? "save" : "create"}`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

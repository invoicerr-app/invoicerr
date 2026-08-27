"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePatch, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import type { Quote } from "@/types"
import { QuoteFormFields, type QuoteFormValues, useQuoteForm } from "./quote-form"
import { queryKeys } from "@/lib/query-keys"
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

    const { trigger: createTrigger } = usePost("/api/quotes")
    const { trigger: updateTrigger } = usePatch(`/api/quotes/${quote?.id}`)

    const form = useQuoteForm(quote)

    const onSubmit = (data: QuoteFormValues) => {
        const trigger = isEdit ? updateTrigger : createTrigger

        trigger(data)
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.quotes.listsAll() })
                onOpenChange(false)
                form.reset()
            })
            .catch((err) => console.error(err))
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
                    <Button type="submit" form="quote-form" dataCy="quote-submit">
                        {t(`quotes.upsert.actions.${isEdit ? "save" : "create"}`)}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

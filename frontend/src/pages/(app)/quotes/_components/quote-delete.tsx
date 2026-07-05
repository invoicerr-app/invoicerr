import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Quote } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

interface QuoteDeleteDialogProps {
    quote: Quote | null
    onOpenChange: (open: boolean) => void
}

export function QuoteDeleteDialog({ quote, onOpenChange }: QuoteDeleteDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { trigger, loading } = useMutationWithToast(
        useDelete(`/api/quotes/${quote?.id}`),
        t("quotes.delete.messages.error", "Failed to delete quote"),
    )

    const handleDelete = () => {
        if (!quote) return

        trigger()
            .then((result) => {
                if (!result) return
                queryClient.invalidateQueries({ queryKey: queryKeys.quotes.listsAll() })
                onOpenChange(false)
            })
    }

    return (
        <Dialog open={quote != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("quotes.delete.title")}</DialogTitle>
                    <DialogDescription>{t("quotes.delete.description")}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)} disabled={loading}>
                        {t("quotes.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} loading={loading}>
                        {t("quotes.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

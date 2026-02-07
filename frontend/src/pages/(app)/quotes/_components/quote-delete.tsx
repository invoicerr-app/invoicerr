import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Quote } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

interface QuoteDeleteDialogProps {
    quote: Quote | null
    onOpenChange: (open: boolean) => void
}

export function QuoteDeleteDialog({ quote, onOpenChange }: QuoteDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger } = useDelete(`/api/quotes/${quote?.id}`)

    const handleDelete = () => {
        if (!quote) return

        trigger()
            .then(() => {
                onOpenChange(false)
            })
            .catch((error) => {
                console.error("Failed to delete quote:", error)
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
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)}>
                        {t("quotes.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete}>
                        {t("quotes.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

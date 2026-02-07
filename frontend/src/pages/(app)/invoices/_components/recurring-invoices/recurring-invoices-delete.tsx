import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { RecurringInvoice } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

interface RecurringInvoiceDeleteDialogProps {
    recurringInvoice: RecurringInvoice | null
    onOpenChange: (open: boolean) => void
}

export function RecurringInvoiceDeleteDialog({ recurringInvoice, onOpenChange }: RecurringInvoiceDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger } = useDelete(`/api/recurring-invoices/${recurringInvoice?.id}`)

    const handleDelete = () => {
        if (!recurringInvoice) return

        trigger()
            .then(() => {
                onOpenChange(false)
            })
            .catch((error) => {
                console.error("Failed to delete recurringInvoice:", error)
            })
    }

    return (
        <Dialog open={recurringInvoice != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("recurringInvoices.delete.title")}</DialogTitle>
                    <DialogDescription>{t("recurringInvoices.delete.description")}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)}>
                        {t("recurringInvoices.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete}>
                        {t("recurringInvoices.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

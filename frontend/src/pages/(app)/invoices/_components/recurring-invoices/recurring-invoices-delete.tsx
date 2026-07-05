import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { RecurringInvoice } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { useTranslation } from "react-i18next"

interface RecurringInvoiceDeleteDialogProps {
    recurringInvoice: RecurringInvoice | null
    onOpenChange: (open: boolean) => void
}

export function RecurringInvoiceDeleteDialog({ recurringInvoice, onOpenChange }: RecurringInvoiceDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger, loading } = useMutationWithToast(
        useDelete(`/api/recurring-invoices/${recurringInvoice?.id}`),
        t("recurringInvoices.delete.messages.error", "Failed to delete recurring invoice"),
    )

    const handleDelete = () => {
        if (!recurringInvoice) return

        trigger()
            .then((result) => {
                if (!result) return
                onOpenChange(false)
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
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)} disabled={loading}>
                        {t("recurringInvoices.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} loading={loading}>
                        {t("recurringInvoices.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Invoice } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

interface InvoiceDeleteDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
}

export function InvoiceDeleteDialog({ invoice, onOpenChange }: InvoiceDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger } = useDelete(`/api/invoices/${invoice?.id}`)

    const handleDelete = () => {
        if (!invoice) return

        trigger()
            .then(() => {
                onOpenChange(false)
            })
            .catch((error) => {
                console.error("Failed to delete invoice:", error)
            })
    }

    return (
        <Dialog open={invoice != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("invoices.delete.title")}</DialogTitle>
                    <DialogDescription>{t("invoices.delete.description")}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)}>
                        {t("invoices.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete}>
                        {t("invoices.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

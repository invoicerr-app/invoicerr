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
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

interface InvoiceDeleteDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
}

export function InvoiceDeleteDialog({ invoice, onOpenChange }: InvoiceDeleteDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { trigger, loading } = useMutationWithToast(
        useDelete(`/api/invoices/${invoice?.id}`),
        t("invoices.delete.messages.error", "Failed to delete invoice"),
    )

    const handleDelete = () => {
        if (!invoice) return

        trigger()
            .then((result) => {
                if (!result) return
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
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
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)} disabled={loading}>
                        {t("invoices.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} loading={loading}>
                        {t("invoices.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

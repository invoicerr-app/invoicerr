import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Payment } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

interface PaymentDeleteDialogProps {
    payment: Payment | null
    onOpenChange: (open: boolean) => void
}

export function PaymentDeleteDialog({ payment, onOpenChange }: PaymentDeleteDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { trigger } = useDelete(`/api/payments/${payment?.id}`)

    const handleDelete = () => {
        if (!payment) return

        trigger()
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.payments.listsAll() })
                // Deleting a payment can update the invoice's paid amount/status, so refetch invoices.
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
            })
            .catch((error) => {
                console.error("Failed to delete payment:", error)
            })
    }

    return (
        <Dialog open={payment != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("payments.delete.title")}</DialogTitle>
                    <DialogDescription>{t("payments.delete.description")}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)}>
                        {t("payments.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete}>
                        {t("payments.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

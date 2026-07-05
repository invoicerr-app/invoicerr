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
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
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
    const { trigger, loading } = useMutationWithToast(
        useDelete(`/api/payments/${payment?.id}`),
        t("payments.delete.messages.error", "Failed to delete payment"),
    )

    const handleDelete = () => {
        if (!payment) return

        trigger()
            .then((result) => {
                if (!result) return
                queryClient.invalidateQueries({ queryKey: queryKeys.payments.listsAll() })
                // Deleting a payment can update the invoice's paid amount/status, so refetch invoices.
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
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
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)} disabled={loading}>
                        {t("payments.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete} loading={loading}>
                        {t("payments.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

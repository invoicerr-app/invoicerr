import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Receipt } from "@/types"
import { useDelete } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

interface ReceiptDeleteDialogProps {
    receipt: Receipt | null
    onOpenChange: (open: boolean) => void
}

export function ReceiptDeleteDialog({ receipt, onOpenChange }: ReceiptDeleteDialogProps) {
    const { t } = useTranslation()
    const { trigger } = useDelete(`/api/receipts/${receipt?.id}`)

    const handleDelete = () => {
        if (!receipt) return

        trigger()
            .then(() => {
                onOpenChange(false)
            })
            .catch((error) => {
                console.error("Failed to delete receipt:", error)
            })
    }

    return (
        <Dialog open={receipt != null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("receipts.delete.title")}</DialogTitle>
                    <DialogDescription>{t("receipts.delete.description")}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
                    <Button variant="outline" className="w-full bg-transparent" onClick={() => onOpenChange(false)}>
                        {t("receipts.delete.actions.cancel")}
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={handleDelete}>
                        {t("receipts.delete.actions.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import type { Expense } from "@/types"
import { toast } from "sonner"
import { useDeleteExpense } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

export function ExpenseDeleteDialog({
    expense,
    onOpenChange,
}: {
    expense?: Expense | null
    onOpenChange: (open: boolean) => void
}) {
    const { t } = useTranslation()
    const deleteExpense = useDeleteExpense()
    const open = !!expense

    const handleDelete = async () => {
        if (!expense) return
        try {
            await deleteExpense.mutateAsync(expense.id)
            toast.success(t("expenses.upsert.messages.deleteSuccess"))
            onOpenChange(false)
        } catch (err) {
            console.error(err)
            toast.error(t("expenses.upsert.messages.deleteError"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t("expenses.delete.title")}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {t("expenses.delete.description", { description: expense?.description })}
                    </p>

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleteExpense.isPending}>
                            {t("expenses.actions.cancel")}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} loading={deleteExpense.isPending} dataCy="expense-delete-confirm">
                            {t("expenses.actions.delete")}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

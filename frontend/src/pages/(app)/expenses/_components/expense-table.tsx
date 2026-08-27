import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { Expense } from "@/types"
import { Copy, Pencil, Trash2 } from "lucide-react"
import { dataCy } from "@/lib/utils"
import { useTranslation } from "react-i18next"

interface ExpenseTableProps {
    expenses: Expense[]
    onEdit: (expense: Expense) => void
    onDelete: (expense: Expense) => void
    onDuplicate: (expense: Expense) => void
}

export function ExpenseTable({ expenses, onEdit, onDelete, onDuplicate }: ExpenseTableProps) {
    const { t } = useTranslation()

    return (
        <Card className="gap-0">
            <CardContent className="p-4 sm:p-6">
                {expenses.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-12">
                        {t("expenses.table.emptyState")}
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("expenses.table.columns.description")}</TableHead>
                                <TableHead>{t("expenses.table.columns.amount")}</TableHead>
                                <TableHead>{t("expenses.table.columns.date")}</TableHead>
                                <TableHead>{t("expenses.table.columns.notes")}</TableHead>
                                <TableHead className="text-right">{t("expenses.table.columns.actions")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {expenses.map((expense) => (
                                <TableRow key={expense.id} {...dataCy(`expense-row-${expense.id}`)}>
                                    <TableCell>{expense.description}</TableCell>
                                    <TableCell>
                                        {t("common.valueWithCurrency", {
                                            currency: expense.currency,
                                            amount: expense.amount.toFixed(2),
                                        })}
                                    </TableCell>
                                    <TableCell>{new Date(expense.date).toLocaleDateString()}</TableCell>
                                    <TableCell className="max-w-xs truncate text-muted-foreground">{expense.notes}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onDuplicate(expense)}
                                                tooltip={t("expenses.table.tooltips.duplicate")}
                                                dataCy={`expense-duplicate-${expense.id}`}
                                            >
                                                <Copy className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onEdit(expense)}
                                                tooltip={t("expenses.table.tooltips.edit")}
                                                dataCy={`expense-edit-${expense.id}`}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onDelete(expense)}
                                                tooltip={t("expenses.table.tooltips.delete")}
                                                dataCy={`expense-delete-${expense.id}`}
                                            >
                                                <Trash2 className="h-4 w-4 text-red-700" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}

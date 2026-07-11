import { addMonths, format, isSameMonth, startOfMonth, subMonths } from "date-fns"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react"
import { ExpenseDeleteDialog } from "@/pages/(app)/expenses/_components/expense-delete"
import { ExpenseTable } from "@/pages/(app)/expenses/_components/expense-table"
import { ExpenseUpsert } from "@/pages/(app)/expenses/_components/expense-upsert"
import { Input } from "@/components/ui/input"
import type { Expense } from "@/types"
import { languageToLocale } from "@/lib/i18n"
import { toast } from "sonner"
import { useCreateExpense, useExpenses } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export default function ExpensesPage() {
  const { t, i18n } = useTranslation()
  const { data: expenses = [] } = useExpenses()
  const [searchTerm, setSearchTerm] = useState("")
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [upsertTarget, setUpsertTarget] = useState<Expense | null>(null)
  const [upsertOpen, setUpsertOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)

  const createExpense = useCreateExpense()

  usePageHeader(t("sidebar.navigation.expenses"))

  const filtered = useMemo(
    () =>
      (expenses || []).filter(
        (expense) =>
          isSameMonth(new Date(expense.date), currentMonth) &&
          (expense.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (expense.notes || "").toLowerCase().includes(searchTerm.toLowerCase())),
      ),
    [expenses, searchTerm, currentMonth],
  )

  const handleAdd = () => {
    setUpsertTarget(null)
    setUpsertOpen(true)
  }

  const handleEdit = (expense: Expense) => {
    setUpsertTarget(expense)
    setUpsertOpen(true)
  }

  const handleExport = () => {
    const header = [
      t("expenses.table.columns.description"),
      t("expenses.table.columns.amount"),
      t("expenses.table.columns.date"),
      t("expenses.table.columns.notes"),
    ]

    const lines = filtered.map((expense) => [
      expense.description,
      `${expense.amount.toFixed(2)} ${expense.currency}`,
      new Date(expense.date).toLocaleDateString(),
      expense.notes || "",
    ])

    const csv = [header, ...lines]
      .map((line) => line.map((cell) => csvEscape(String(cell))).join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `expenses-${format(currentMonth, "yyyy-MM")}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDuplicate = async (expense: Expense) => {
    try {
      await createExpense.mutateAsync({
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        date: new Date(),
        notes: expense.notes || undefined,
      })
      toast.success(t("expenses.upsert.messages.duplicateSuccess"))
    } catch (err) {
      console.error(err)
      toast.error(t("expenses.upsert.messages.duplicateError"))
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Input
          className="max-w-sm"
          placeholder={t("expenses.search.placeholder")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          data-cy="expenses-search"
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            dataCy="expenses-month-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-36 text-center text-sm font-medium capitalize"
            data-cy="expenses-month-label"
          >
            {format(currentMonth, "MMMM yyyy", { locale: languageToLocale(i18n.language) })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            dataCy="expenses-month-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            disabled={filtered.length === 0}
            dataCy="expenses-export"
          >
            <Download className="h-4 w-4 mr-2" />
            {t("expenses.actions.export")}
          </Button>
          <Button onClick={handleAdd} dataCy="expenses-add">
            <Plus className="h-4 w-4 mr-2" />
            {t("expenses.actions.add")}
          </Button>
        </div>
      </div>

      <ExpenseTable
        expenses={filtered}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        onDuplicate={handleDuplicate}
      />

      <ExpenseUpsert expense={upsertTarget} open={upsertOpen} onOpenChange={setUpsertOpen} />
      <ExpenseDeleteDialog expense={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} />
    </div>
  )
}

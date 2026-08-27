"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useCreateExpense, useUpdateExpense } from "@/hooks/queries"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import CurrencySelect from "@/components/currency-select"
import { DatePicker } from "@/components/date-picker"
import type { Expense } from "@/types"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface ExpenseUpsertProps {
    expense?: Expense | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ExpenseUpsert({ expense, open, onOpenChange }: ExpenseUpsertProps) {
    const { t } = useTranslation()
    const isEdit = !!expense

    const expenseSchema = z.object({
        description: z.string().min(1, t("expenses.upsert.form.description.errors.required")),
        amount: z
            .number({ invalid_type_error: t("expenses.upsert.form.amount.errors.required") })
            .min(0, t("expenses.upsert.form.amount.errors.min")),
        currency: z.string().min(1),
        date: z.date(),
        notes: z.string().optional(),
    })

    type ExpenseFormValues = z.infer<typeof expenseSchema>

    const createExpense = useCreateExpense()
    const updateExpense = useUpdateExpense()

    const form = useForm<ExpenseFormValues>({
        resolver: zodResolver(expenseSchema),
        defaultValues: {
            description: "",
            amount: 0,
            currency: "EUR",
            date: new Date(),
            notes: "",
        },
    })

    useEffect(() => {
        if (expense) {
            form.reset({
                description: expense.description,
                amount: expense.amount,
                currency: expense.currency,
                date: new Date(expense.date),
                notes: expense.notes || "",
            })
        } else {
            form.reset({
                description: "",
                amount: 0,
                currency: "EUR",
                date: new Date(),
                notes: "",
            })
        }
    }, [expense, open, form])

    const onSubmit = async (data: ExpenseFormValues) => {
        try {
            if (isEdit && expense) {
                await updateExpense.mutateAsync({ ...data, id: expense.id })
            } else {
                await createExpense.mutateAsync(data)
            }
            toast.success(
                isEdit ? t("expenses.upsert.messages.updateSuccess") : t("expenses.upsert.messages.addSuccess"),
            )
            onOpenChange(false)
        } catch (err) {
            console.error(err)
            toast.error(
                isEdit ? t("expenses.upsert.messages.updateError") : t("expenses.upsert.messages.addError"),
            )
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md" dataCy="expense-dialog">
                <DialogHeader>
                    <DialogTitle>{t(`expenses.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-cy="expense-form">
                        <FormField
                            name="description"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel required>{t("expenses.upsert.form.description.label")}</FormLabel>
                                    <FormControl>
                                        <BetterInput {...field} placeholder={t("expenses.upsert.form.description.placeholder")} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex gap-2">
                            <FormField
                                name="amount"
                                control={form.control}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel required>{t("expenses.upsert.form.amount.label")}</FormLabel>
                                        <FormControl>
                                            <BetterInput
                                                {...field}
                                                type="number"
                                                step="0.01"
                                                placeholder={t("expenses.upsert.form.amount.placeholder")}
                                                onChange={(e) =>
                                                    field.onChange(e.target.value === "" ? undefined : Number.parseFloat(e.target.value))
                                                }
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                name="currency"
                                control={form.control}
                                render={({ field }) => (
                                    <FormItem className="w-40">
                                        <FormLabel required>{t("expenses.upsert.form.currency.label")}</FormLabel>
                                        <FormControl>
                                            <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            name="date"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel required>{t("expenses.upsert.form.date.label")}</FormLabel>
                                    <FormControl>
                                        <DatePicker className="w-full" value={field.value} onChange={(date) => field.onChange(date || new Date())} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            name="notes"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("expenses.upsert.form.notes.label")}</FormLabel>
                                    <FormControl>
                                        <Textarea {...field} placeholder={t("expenses.upsert.form.notes.placeholder")} className="max-h-32" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                {t("expenses.actions.cancel")}
                            </Button>
                            <Button type="submit" loading={createExpense.isPending || updateExpense.isPending} dataCy="expense-submit">
                                {isEdit ? t("expenses.actions.save") : t("expenses.actions.add")}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

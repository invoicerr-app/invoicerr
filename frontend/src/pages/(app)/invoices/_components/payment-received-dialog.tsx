"use client"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useEffect, useState } from "react"
import { usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { PaymentBreakdown } from "@/components/payment-breakdown"
import type { DistributedItem } from "@/lib/payment-distribution"
import type { Invoice, Payment } from "@/types"
import { distributePayment } from "@/lib/payment-distribution"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface PaymentReceivedDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
}

export function PaymentReceivedDialog({ invoice, onOpenChange }: PaymentReceivedDialogProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { trigger: createPaymentFromInvoice, loading } = usePost<Payment>("/api/payments/create-from-invoice")

    const alreadyPaid = invoice?.payments?.reduce((sum, p) => sum + p.totalPaid, 0) ?? 0
    const remaining = Math.max(0, (invoice?.totalTTC ?? 0) - alreadyPaid)

    const schema = z.object({
        amount: z.coerce.number()
            .positive(t("invoices.paymentReceived.fields.amount.errors.required"))
            .max(remaining + 0.01, t("invoices.paymentReceived.fields.amount.errors.tooHigh")),
    })

    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { amount: remaining },
    })

    const [items, setItems] = useState<DistributedItem[]>([])
    // Bumped whenever items are recomputed from the total, to remount the editable inputs.
    const [redistributeKey, setRedistributeKey] = useState(0)

    useEffect(() => {
        if (invoice) {
            form.reset({ amount: remaining })
            setItems(distributePayment(invoice, remaining))
            setRedistributeKey(k => k + 1)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invoice?.id])

    const amount = form.watch("amount") ?? 0
    const percent = invoice && invoice.totalTTC > 0
        ? Math.min(100, Math.round(((alreadyPaid + amount) / invoice.totalTTC) * 100))
        : 0

    // Typing in the total redistributes proportionally across the invoice items.
    const redistribute = (total: number) => {
        setItems(invoice ? distributePayment(invoice, total) : [])
        setRedistributeKey(k => k + 1)
    }

    // Editing one item's amount makes the total the sum of all items.
    const handleItemChange = (index: number, value: number) => {
        setItems(prev => {
            const next = prev.map((it, i) => (i === index ? { ...it, amountPaid: value } : it))
            const sum = Math.round(next.reduce((s, it) => s + it.amountPaid, 0) * 100) / 100
            form.setValue("amount", sum)
            return next
        })
    }

    const handleOpenChange = (open: boolean) => {
        if (!open) form.reset()
        onOpenChange(open)
    }

    const onSubmit = (data: z.infer<typeof schema>) => {
        if (!invoice) return
        createPaymentFromInvoice({
            id: invoice.id,
            amount: data.amount,
            items: items.map(item => ({ invoiceItemId: item.invoiceItemId, amountPaid: item.amountPaid })),
        })
            .then((payment) => {
                toast.success(t("invoices.list.messages.markAsPaidSuccess"))
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                queryClient.invalidateQueries({ queryKey: queryKeys.payments.listsAll() })
                handleOpenChange(false)
                if (payment) navigate(`/payments/pdf/${payment.id}`, { state: { payment } })
            })
            .catch(() => {
                toast.error(t("invoices.list.messages.markAsPaidError"))
            })
    }

    return (
        <Dialog open={!!invoice} onOpenChange={handleOpenChange}>
            <DialogContent dataCy="payment-received-dialog">
                <DialogHeader>
                    <DialogTitle>{t("invoices.paymentReceived.title")}</DialogTitle>
                    <DialogDescription>{t("invoices.paymentReceived.description")}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} data-cy="payment-received-form">
                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel required>{t("invoices.paymentReceived.fields.amount.label")}</FormLabel>
                                    <FormControl>
                                        <BetterInput
                                            {...field}
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            postAdornment={invoice?.currency}
                                            placeholder={t("invoices.paymentReceived.fields.amount.placeholder")}
                                            onChange={(e) => {
                                                const value = e.target.value === "" ? "" : Number.parseFloat(e.target.value)
                                                field.onChange(value)
                                                redistribute(Number(value) || 0)
                                            }}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <p className="text-sm text-muted-foreground mt-2">
                            {t("invoices.paymentReceived.percentLabel", { percent })}
                        </p>
                        <PaymentBreakdown
                            items={items}
                            currency={invoice?.currency}
                            editable
                            redistributeKey={redistributeKey}
                            onItemChange={handleItemChange}
                        />
                    </form>
                </Form>
                <DialogFooter className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                        {t("invoices.paymentReceived.actions.cancel")}
                    </Button>
                    <Button type="button" onClick={form.handleSubmit(onSubmit)} loading={loading} dataCy="payment-received-submit">
                        {t("invoices.paymentReceived.actions.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

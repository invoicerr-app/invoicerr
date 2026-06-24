"use client"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useEffect } from "react"
import { usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { PaymentBreakdown } from "@/components/payment-breakdown"
import type { Invoice } from "@/types"
import { distributePayment } from "@/lib/payment-distribution"
import { useForm } from "react-hook-form"
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
    const queryClient = useQueryClient()
    const { trigger: createPaymentFromInvoice, loading } = usePost("/api/payments/create-from-invoice")

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

    useEffect(() => {
        if (invoice) {
            form.reset({ amount: remaining })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invoice?.id])

    const amount = form.watch("amount") ?? 0
    const percent = invoice && invoice.totalTTC > 0
        ? Math.min(100, Math.round(((alreadyPaid + amount) / invoice.totalTTC) * 100))
        : 0
    const breakdownItems = invoice ? distributePayment(invoice, Number(amount) || 0) : []

    const handleOpenChange = (open: boolean) => {
        if (!open) form.reset()
        onOpenChange(open)
    }

    const onSubmit = (data: z.infer<typeof schema>) => {
        if (!invoice) return
        createPaymentFromInvoice({ id: invoice.id, amount: data.amount })
            .then(() => {
                toast.success(t("invoices.list.messages.markAsPaidSuccess"))
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                queryClient.invalidateQueries({ queryKey: queryKeys.payments.listsAll() })
                handleOpenChange(false)
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
                                            onChange={(e) => field.onChange(e.target.value === "" ? "" : Number.parseFloat(e.target.value))}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <p className="text-sm text-muted-foreground mt-2">
                            {t("invoices.paymentReceived.percentLabel", { percent })}
                        </p>
                        <PaymentBreakdown items={breakdownItems} currency={invoice?.currency} />
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

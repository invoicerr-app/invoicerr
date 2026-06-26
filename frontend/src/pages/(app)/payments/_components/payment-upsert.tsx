"use client"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import type { Invoice, PaymentMethod, Payment } from "@/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useState } from "react"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useInvoiceSearch, usePaymentMethods } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import { DatePicker } from "@/components/date-picker"
import { InvoiceStatus, PaymentMethodType } from "@/types"
import { PaymentBreakdown } from "@/components/payment-breakdown"
import SearchSelect from "@/components/search-input"
import type { DistributedItem } from "@/lib/payment-distribution"
import { distributePayment } from "@/lib/payment-distribution"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface PaymentUpsertDialogProps {
    payment?: Payment | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function PaymentUpsert({ payment, open, onOpenChange }: PaymentUpsertDialogProps) {
    const { t } = useTranslation()
    const isEdit = !!payment
    const queryClient = useQueryClient()

    const [clientDialogOpen, setClientDialogOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
    const [items, setItems] = useState<DistributedItem[]>([])
    // Bumped whenever items are recomputed from the total, to remount the editable inputs.
    const [redistributeKey, setRedistributeKey] = useState(0)

    const initialAmount = payment?.items.reduce((sum, item) => sum + item.amountPaid, 0) ?? 0

    const paymentSchema = z.object({
        invoiceId: z.string().optional(),
        paymentMethodId: z.string().optional(),
        paidAt: z.date().optional(),
        amount: z.coerce.number(),
    })

    const { data: invoices } = useInvoiceSearch(searchTerm)
    // Draft and archived invoices can't receive a payment, so they aren't selectable.
    const invoiceList = (Array.isArray(invoices) ? invoices : [])
        .filter(inv => inv.status !== InvoiceStatus.DRAFT && inv.status !== InvoiceStatus.ARCHIVED)
    const { data: paymentMethods } = usePaymentMethods()
    const { trigger: createTrigger, loading: createLoading } = usePost("/api/payments")
    const { trigger: updateTrigger, loading: updateLoading } = usePatch(`/api/payments/${payment?.id}`)

    const form = useForm<z.infer<typeof paymentSchema>>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            invoiceId: payment?.invoiceId || "",
            paymentMethodId: payment?.paymentMethodId || "",
            paidAt: payment?.paidAt ? new Date(payment.paidAt) : new Date(),
            amount: initialAmount,
        },
    })

    useEffect(() => {
        if (isEdit && payment) {
            form.reset({
                invoiceId: payment.invoiceId || "",
                paymentMethodId: (payment as any).paymentMethodId || "",
                paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date(),
                amount: payment.items.reduce((sum, item) => sum + item.amountPaid, 0),
            })
            setSelectedInvoice(payment.invoice || null)
            setItems(payment.items.map(item => ({
                invoiceItemId: item.invoiceItemId,
                name: payment.invoice?.items.find(invItem => invItem.id === item.invoiceItemId)?.name || "",
                amountPaid: item.amountPaid,
            })))
            setRedistributeKey(k => k + 1)
        } else {
            form.reset({
                invoiceId: "",
                paymentMethodId: "",
                paidAt: new Date(),
                amount: 0,
            })
            setSelectedInvoice(null)
            setItems([])
        }
    }, [payment, form, isEdit])

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedInvoice(null)
            setItems([])
            form.reset()
        }
        onOpenChange(open)
    }

    const amount = form.watch("amount")

    // Typing in the total redistributes proportionally across the invoice items.
    const redistribute = (invoice: Invoice | null, total: number) => {
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

    const onSubmit = (data: z.infer<typeof paymentSchema>) => {
        const trigger = isEdit ? updateTrigger : createTrigger
        const { paidAt, amount: _amount, ...rest } = data
        trigger({
            ...rest,
            paidAt: paidAt ? paidAt.toISOString() : undefined,
            items: items.map(item => ({
                invoiceItemId: item.invoiceItemId,
                invoiceId: selectedInvoice?.id || "",
                amountPaid: item.amountPaid,
                paymentId: payment?.id || ""
            }))
        })
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.payments.listsAll() })
                // A payment change can update the invoice's paid amount/status, so refetch invoices.
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
                form.reset()
            })
            .catch((err) => console.error(err))
    }

    useEffect(() => {
        if (selectedInvoice) {
            form.setValue("paymentMethodId", selectedInvoice.paymentMethodId || "")
        }
    }, [form, selectedInvoice])

    const otherPaymentsTotal = (selectedInvoice?.payments ?? [])
        .filter(p => p.id !== payment?.id)
        .reduce((sum, p) => sum + p.totalPaid, 0)
    const hasNegativeTotalError = otherPaymentsTotal + (Number(amount) || 0) < 0

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="max-w-sm lg:max-w-4xl min-w-fit max-h-[90vh] overflow-y-auto overflow-visible" dataCy="payment-dialog">
                    <DialogHeader className="h-fit">
                        <DialogTitle>{t(`payments.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} data-cy="payment-form">
                            <FormField
                                control={form.control}
                                name="invoiceId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel required>{t("payments.upsert.form.invoice.label")}</FormLabel>
                                        <FormControl>
                                            <SearchSelect
                                                options={invoiceList.map((invoice) => ({ label: invoice.rawNumber || invoice.number.toString(), value: invoice.id }))}
                                                value={field.value ?? ""}
                                                onValueChange={(val) => { field.onChange(val || null); const inv = invoiceList.find(inv => inv.id === val) || null; setSelectedInvoice(inv); redistribute(inv, Number(form.getValues("amount")) || 0); }}
                                                onSearchChange={setSearchTerm}
                                                placeholder={t("payments.upsert.form.invoice.placeholder")}
                                                noResultsText={t("payments.upsert.form.invoice.noResults")}
                                                data-cy="payment-invoice-select"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="paymentMethodId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("payments.upsert.form.paymentMethod.label")}</FormLabel>
                                        <FormControl>
                                            <Select value={field.value ?? ""} onValueChange={(val) => field.onChange(val || "")}>
                                                <SelectTrigger className="w-full" aria-label={t("payments.upsert.form.paymentMethod.label") as string}>
                                                    <SelectValue placeholder={t("payments.upsert.form.paymentMethod.placeholder")} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(paymentMethods || []).map((pm: PaymentMethod) => (
                                                        <SelectItem key={pm.id} value={pm.id}>
                                                            {pm.name} - {pm.type == PaymentMethodType.BANK_TRANSFER ? t("paymentMethods.fields.type.bank_transfer") : pm.type == PaymentMethodType.PAYPAL ? t("paymentMethods.fields.type.paypal") : pm.type == PaymentMethodType.CHECK ? t("paymentMethods.fields.type.check") : pm.type == PaymentMethodType.CASH ? t("paymentMethods.fields.type.cash") : pm.type == PaymentMethodType.OTHER ? t("paymentMethods.fields.type.other") : pm.type}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="paidAt"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>{t("payments.upsert.form.paidAt.label")}</FormLabel>
                                        <DatePicker
                                            className="w-full"
                                            value={field.value || null}
                                            onChange={field.onChange}
                                            placeholder={t("payments.upsert.form.paidAt.placeholder")}
                                            data-cy="payment-paidAt-picker"
                                        />
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel required>{t("payments.upsert.form.amount.label")}</FormLabel>
                                        <FormControl>
                                            <BetterInput
                                                {...field}
                                                type="number"
                                                step="0.01"
                                                postAdornment={selectedInvoice?.currency || ""}
                                                placeholder={t("payments.upsert.form.amount.placeholder")}
                                                disabled={!selectedInvoice}
                                                data-cy="payment-amount-input"
                                                onChange={(e) => {
                                                    const value = e.target.value === "" ? "" : Number.parseFloat(e.target.value)
                                                    field.onChange(value)
                                                    redistribute(selectedInvoice, Number(value) || 0)
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <PaymentBreakdown
                                items={items}
                                currency={selectedInvoice?.currency}
                                editable
                                redistributeKey={redistributeKey}
                                onItemChange={handleItemChange}
                            />

                            {hasNegativeTotalError && (
                                <p className="text-sm text-destructive mt-2">
                                    {t("payments.upsert.form.items.errors.negativeTotal")}
                                </p>
                            )}
                        </form>
                    </Form>
                    <DialogFooter className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t("payments.upsert.actions.cancel")}
                        </Button>
                        <Button type="button" onClick={form.handleSubmit(onSubmit)} loading={createLoading || updateLoading} disabled={hasNegativeTotalError || !selectedInvoice} dataCy="payment-submit">
                            {t(`payments.upsert.actions.${isEdit ? "save" : "create"}`)}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ClientUpsert
                open={clientDialogOpen}
                onOpenChange={setClientDialogOpen}
            />
        </>
    )
}

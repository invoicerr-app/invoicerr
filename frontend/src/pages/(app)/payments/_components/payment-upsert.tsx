"use client"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import type { Invoice, PaymentMethod, Payment } from "@/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useMemo, useState } from "react"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useInvoiceSearch, usePaymentMethods } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import { DatePicker } from "@/components/date-picker"
import { InvoiceStatus, PaymentMethodType } from "@/types"
import SearchSelect from "@/components/search-input"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

const clampDiscount = (r?: number) => Math.min(Math.max(r ?? 0, 0), 100)

function distribute(invoice: Invoice, total: number): Item[] {
    const discountFactor = 1 - clampDiscount(invoice.discountRate) / 100
    const ratio = invoice.totalTTC > 0 ? total / invoice.totalTTC : 0
    const list = (invoice.items ?? []).map(it => {
        const fullTTC = it.quantity * it.unitPrice * discountFactor * (1 + (it.vatRate || 0) / 100)
        return { invoiceItemId: it.id, description: it.description, amountPaid: Math.round(fullTTC * ratio * 100) / 100 }
    })
    // adjust the last item by the rounding remainder so the breakdown sums exactly to the entered total
    const diff = Math.round((total - list.reduce((s, i) => s + i.amountPaid, 0)) * 100) / 100
    if (list.length && diff !== 0) list[list.length - 1].amountPaid += diff
    return list
}

interface PaymentUpsertDialogProps {
    payment?: Payment | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface Item {
    invoiceItemId: string
    description: string
    amountPaid: number
}

export function PaymentUpsert({ payment, open, onOpenChange }: PaymentUpsertDialogProps) {
    const { t } = useTranslation()
    const isEdit = !!payment
    const queryClient = useQueryClient()

    const [clientDialogOpen, setClientDialogOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

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
        } else {
            form.reset({
                invoiceId: "",
                paymentMethodId: "",
                paidAt: new Date(),
                amount: 0,
            })
            setSelectedInvoice(null)
        }
    }, [payment, form, isEdit])

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedInvoice(null)
            form.reset()
        }
        onOpenChange(open)
    }

    const amount = form.watch("amount")
    const items = useMemo(
        () => (selectedInvoice ? distribute(selectedInvoice, Number(amount) || 0) : []),
        [selectedInvoice, amount],
    )

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
                                                onValueChange={(val) => { field.onChange(val || null); setSelectedInvoice(invoiceList.find(inv => inv.id === val) || null); }}
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
                                                onChange={(e) => field.onChange(e.target.value === "" ? "" : Number.parseFloat(e.target.value))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {selectedInvoice && items.length > 0 && (
                                <FormItem className="flex flex-col gap-2 mt-2">
                                    <FormLabel className="mb-0">{t("payments.upsert.form.breakdown.label")}</FormLabel>
                                    <div className="flex flex-col gap-2">
                                        {items.map((item) => (
                                            <div className="flex gap-2 items-center" key={item.invoiceItemId}>
                                                <FormItem className="flex-1">
                                                    <FormControl>
                                                        <BetterInput value={item.description || ""} disabled />
                                                    </FormControl>
                                                </FormItem>
                                                <FormItem>
                                                    <FormControl>
                                                        <BetterInput
                                                            value={item.amountPaid}
                                                            type="number"
                                                            postAdornment={selectedInvoice?.currency || ""}
                                                            disabled
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            </div>
                                        ))}
                                    </div>
                                </FormItem>
                            )}

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

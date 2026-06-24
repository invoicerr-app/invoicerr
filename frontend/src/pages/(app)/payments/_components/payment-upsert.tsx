"use client"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import type { Invoice, InvoiceItem, PaymentMethod, Payment } from "@/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useState } from "react"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useInvoiceSearch, usePaymentMethods } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import { PaymentMethodType } from "@/types"
import SearchSelect from "@/components/search-input"
import { Trash2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

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
    const [selectedItem, setSelectedItem] = useState<InvoiceItem | null>(null)
    const [items, setItems] = useState<Item[]>(payment?.items.map(item => ({
        invoiceItemId: item.invoiceItemId,
        description: payment.invoice?.items.find(invItem => invItem.id === item.invoiceItemId)?.description || "",
        amountPaid: item.amountPaid
    })) || [])

    const paymentSchema = z.object({
        invoiceId: z.string().optional(),
        paymentMethodId: z.string().optional(),
    })

    const { data: invoices } = useInvoiceSearch(searchTerm)
    const invoiceList = Array.isArray(invoices) ? invoices : []
    const { data: paymentMethods } = usePaymentMethods()
    const { trigger: createTrigger, loading: createLoading } = usePost("/api/payments")
    const { trigger: updateTrigger, loading: updateLoading } = usePatch(`/api/payments/${payment?.id}`)

    const form = useForm<z.infer<typeof paymentSchema>>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            invoiceId: payment?.invoiceId || "",
            paymentMethodId: payment?.paymentMethodId || ""
        },
    })

    useEffect(() => {
        if (isEdit && payment) {
            form.reset({
                invoiceId: payment.invoiceId || "",
                paymentMethodId: (payment as any).paymentMethodId || ""
            })
            setItems(payment.items.map(item => ({
                invoiceItemId: item.invoiceItemId,
                description: payment.invoice?.items.find(invItem => invItem.id === item.invoiceItemId)?.description || "",
                amountPaid: item.amountPaid
            })))
            setSelectedInvoice(payment.invoice || null)
            setSelectedItem(null)
        } else {
            form.reset({
                invoiceId: "",
                paymentMethodId: ""
            })
            setItems([])
        }
    }, [payment, form, isEdit])

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedInvoice(null)
            setSelectedItem(null)
            setItems([])
            form.reset()
        }
        onOpenChange(open)
    }

    const onSubmit = (data: z.infer<typeof paymentSchema>) => {
        const trigger = isEdit ? updateTrigger : createTrigger
        trigger({
            ...data,
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

    const onAddItem = () => {
        if (selectedItem) {
            setItems([...items, {
                invoiceItemId: selectedItem.id,
                description: selectedItem.description,
                amountPaid: selectedItem.unitPrice * selectedItem.quantity
            }])
        }
    }

    const onRemoveItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index))
    }

    const onEditItem = (index: number, field: keyof Item) => (value: string | number) => {
        setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item))
    }

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
                                                onValueChange={(val) => { field.onChange(val || null); setSelectedInvoice(invoiceList.find(inv => inv.id === val) || null); setSelectedItem(null); }}
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
                                        <FormDescription>
                                            {t("payments.upsert.form.paymentMethod.description")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormItem className="flex flex-col gap-2 mt-2">
                                <FormLabel className="mb-0">{t("payments.upsert.form.items.label")}</FormLabel>

                                <section className="grid grid-cols-1 md:grid-cols-4 gap-2 !m-0">
                                    <FormItem className="col-span-3">
                                        <FormControl>
                                            <SearchSelect
                                                options={(selectedInvoice?.items || [])
                                                    .filter(item => !items.some(i => i.invoiceItemId === item.id))
                                                    .map(item => ({ label: item.description, value: item.id }))}
                                                value={selectedItem?.id || undefined}
                                                onValueChange={(val) => {
                                                    setSelectedItem((selectedInvoice?.items || []).find(item => item.id === val) || null);
                                                }}
                                                onSearchChange={setSearchTerm}
                                                placeholder={t("payments.upsert.form.items.placeholder")}
                                                noResultsText={t("payments.upsert.form.items.noResults")}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={!selectedItem}
                                        onClick={onAddItem}
                                    >
                                        {t("payments.upsert.form.items.addButton")}
                                    </Button>
                                </section>
                                <div className="flex flex-col gap-2">
                                    {items.map((item, index) => (
                                        <div className="flex gap-2 items-center">
                                            <FormItem className="flex-1">
                                                <FormControl>
                                                    <BetterInput
                                                        defaultValue={item.description || ""}
                                                        placeholder={t("payments.upsert.form.items.description.placeholder")}
                                                        onChange={(e) => onEditItem(index, "description")(e.target.value)}
                                                        disabled
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                            <FormItem>
                                                <FormControl>
                                                    <BetterInput
                                                        defaultValue={item.amountPaid || ""}
                                                        placeholder={t("payments.upsert.form.items.amountPaid.placeholder")}
                                                        onChange={(e) => onEditItem(index, "amountPaid")(parseFloat(e.target.value))}
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        postAdornment={selectedInvoice?.currency || ""}
                                                        disabled={!selectedInvoice}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>

                                            <Button variant={"outline"} onClick={() => onRemoveItem(index)} type="reset" className="h-8">
                                                <Trash2 className="h-4 w-4 text-red-700" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </FormItem>
                        </form>
                    </Form>
                    <DialogFooter className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t("payments.upsert.actions.cancel")}
                        </Button>
                        <Button type="button" onClick={form.handleSubmit(onSubmit)} loading={createLoading || updateLoading} dataCy="payment-submit">
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

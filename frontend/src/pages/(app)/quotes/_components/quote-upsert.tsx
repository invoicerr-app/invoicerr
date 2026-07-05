"use client"

import type { Client, Quote } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useState } from "react"
import { useClientSearch, usePaymentMethods } from "@/hooks/queries"
import { useDocumentUpsert } from "@/hooks/use-document-upsert"
import { createLineItemSchema } from "@/lib/line-item-schema"
import { queryKeys } from "@/lib/query-keys"

import { Button } from "@/components/ui/button"
import { ClientSelectField } from "@/components/document-form/client-select-field"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import { CurrencyField } from "@/components/document-form/currency-field"
import { DatePicker } from "@/components/date-picker"
import { DiscountRateField } from "@/components/document-form/discount-rate-field"
import { Input } from "@/components/ui/input"
import { LineItemsEditor } from "@/components/document-form/line-items-editor"
import { PaymentMethodField } from "@/components/document-form/payment-method-field"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "react-i18next"
import { z } from "zod"

interface QuoteUpsertDialogProps {
    quote?: Quote | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function QuoteUpsert({ quote, open, onOpenChange }: QuoteUpsertDialogProps) {
    const { t } = useTranslation()
    const isEdit = !!quote

    const [clientDialogOpen, setClientDialogOpen] = useState(false)

    // Move schema inside component to access t function
    const quoteSchema = z.object({
        title: z.string().optional(),
        clientId: z
            .string()
            .min(1, t("quotes.upsert.form.client.errors.required"))
            .refine((val) => val !== "", {
                message: t("quotes.upsert.form.client.errors.required"),
            }),
        currency: z.string().optional(),
        discountRate: z
            .number({ invalid_type_error: t("quotes.upsert.form.discountRate.errors.required") })
            .min(0, t("quotes.upsert.form.discountRate.errors.min"))
            .max(100, t("quotes.upsert.form.discountRate.errors.max")),
        validUntil: z.date().optional(),
        notes: z.string().optional(),
        paymentMethodId: z.string().optional(),
        items: z.array(createLineItemSchema(t, "quotes", z.string())),
    })

    const [searchTerm, setSearchTerm] = useState("")
    const { data: clients } = useClientSearch(searchTerm)
    const { data: paymentMethods } = usePaymentMethods()

    const { form, submit, submitLoading } = useDocumentUpsert({
        entity: quote,
        schema: quoteSchema,
        defaultValues: {
            title: "",
            clientId: "",
            validUntil: undefined,
            discountRate: 0,
            notes: "",
            items: [],
        },
        createUrl: "/api/quotes",
        updateUrl: `/api/quotes/${quote?.id}`,
        errorMessage: t("quotes.upsert.messages.saveError", "Failed to save quote"),
        invalidateKeys: [queryKeys.quotes.listsAll()],
        mapEntityToForm: (quote) => ({
            title: quote.title || "",
            clientId: quote.clientId || "",
            validUntil: quote.validUntil ? new Date(quote.validUntil) : undefined,
            currency: quote.currency,
            discountRate: quote.discountRate ?? 0,
            notes: quote.notes || "",
            paymentMethodId: quote.paymentMethodId || "",
            items: quote.items
                .sort((a, b) => a.order - b.order)
                .map((item) => ({
                    id: item.id,
                    type: item.type,
                    name: item.name || "",
                    description: item.description || "",
                    quantity: item.quantity || 1,
                    unitPrice: item.unitPrice || 0,
                    vatRate: item.vatRate || 0,
                    order: item.order || 0,
                })),
        }),
        onSuccess: () => onOpenChange(false),
    })

    const { control, handleSubmit } = form

    const handleClientCreate = (newClient: Client) => {
        setSearchTerm("")
        form.setValue("clientId", newClient.id)
        clients?.push(newClient)
        form.trigger("clientId")
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="max-w-sm lg:max-w-4xl h-[85dvh] max-h-[85dvh] p-0 gap-0 flex flex-col overflow-hidden"
                    dataCy="quote-dialog"
                >
                    <DialogHeader className="shrink-0 border-b px-6 py-4">
                        <DialogTitle>{t(`quotes.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                    <Form {...form}>
                        <form id="quote-form" onSubmit={handleSubmit(submit)} className="space-y-4" data-cy="quote-form">
                            <FormField
                                control={control}
                                name="title"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("quotes.upsert.form.title.label")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t("quotes.upsert.form.title.placeholder")} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <ClientSelectField
                                translationPrefix="quotes"
                                dataCy="quote-client-select"
                                clients={clients || []}
                                onSearchChange={setSearchTerm}
                                onRequestCreateClient={() => setClientDialogOpen(true)}
                            />

                            <CurrencyField translationPrefix="quotes" dataCy="quote-currency-select" />

                            <DiscountRateField translationPrefix="quotes" />

                            <FormField
                                control={control}
                                name="validUntil"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("quotes.upsert.form.validUntil.label")}</FormLabel>
                                        <FormControl>
                                            <DatePicker
                                                className="w-full"
                                                value={field.value || null}
                                                onChange={field.onChange}
                                                placeholder={t("quotes.upsert.form.validUntil.placeholder")}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("quotes.upsert.form.notes.label")}</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} placeholder={t("quotes.upsert.form.notes.placeholder")} className="max-h-40" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <PaymentMethodField translationPrefix="quotes" paymentMethods={paymentMethods} />

                            <LineItemsEditor translationPrefix="quotes" typeLabelPrefix="invoices" defaultItemType="HOUR" />
                        </form>
                    </Form>
                    </div>

                    <div className="shrink-0 border-t px-6 py-4 flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t("quotes.upsert.actions.cancel")}
                        </Button>
                        <Button type="submit" form="quote-form" loading={submitLoading} dataCy="quote-submit">
                            {t(`quotes.upsert.actions.${isEdit ? "save" : "create"}`)}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <ClientUpsert
                open={clientDialogOpen}
                onOpenChange={setClientDialogOpen}
                onCreate={handleClientCreate}
            />
        </>
    )
}

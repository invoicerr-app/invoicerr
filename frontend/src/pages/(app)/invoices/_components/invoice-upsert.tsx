import type { Client, Invoice, PaymentMethod } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useClientSearch, usePaymentMethods, useQuoteSearch } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { ClientSelectField } from "./client-select-field"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import CurrencySelect from "@/components/currency-select"
import { DatePicker } from "@/components/date-picker"
import { InvoiceLineItemsEditor } from "./invoice-line-items-editor"
import { PaymentMethodType } from "@/types"
import SearchSelect from "@/components/search-input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface InvoiceUpsertDialogProps {
    invoice?: Invoice | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

type CreationMode = "invoice" | "recurring"

function createItemSchema(t: (key: string) => string, translationPrefix: "invoices" | "recurringInvoices", typeSchema: z.ZodTypeAny) {
    return z.object({
        id: z.string().optional(),
        description: z
            .string()
            .min(1, t(`${translationPrefix}.upsert.form.items.description.errors.required`))
            .refine((val) => val !== "", {
                message: t(`${translationPrefix}.upsert.form.items.description.errors.required`),
            }),
        type: typeSchema,
        quantity: z
            .number({
                invalid_type_error: t(`${translationPrefix}.upsert.form.items.quantity.errors.required`),
            })
            .min(0.001, t(`${translationPrefix}.upsert.form.items.quantity.errors.min`))
            .refine((val) => !isNaN(val), {
                message: t(`${translationPrefix}.upsert.form.items.quantity.errors.invalid`),
            }),
        unitPrice: z
            .number({
                invalid_type_error: t(`${translationPrefix}.upsert.form.items.unitPrice.errors.required`),
            })
            .min(0, t(`${translationPrefix}.upsert.form.items.unitPrice.errors.min`))
            .refine((val) => !isNaN(val), {
                message: t(`${translationPrefix}.upsert.form.items.unitPrice.errors.invalid`),
            }),
        vatRate: z
            .number({
                invalid_type_error: t(`${translationPrefix}.upsert.form.items.vatRate.errors.required`),
            })
            .min(0, t(`${translationPrefix}.upsert.form.items.vatRate.errors.min`)),
        order: z.number(),
    })
}

export function InvoiceUpsert({ invoice, open, onOpenChange }: InvoiceUpsertDialogProps) {
    const { t } = useTranslation()
    const isEdit = !!invoice
    const queryClient = useQueryClient()

    const [mode, setMode] = useState<CreationMode>("invoice")

    useEffect(() => {
        if (open) {
            setMode("invoice")
        }
    }, [open])

    const invoiceSchema = z.object({
        quoteId: z
            .string()
            .optional(),
        clientId: z
            .string()
            .min(1, t("invoices.upsert.form.client.errors.required"))
            .refine((val) => val !== "", {
                message: t("invoices.upsert.form.client.errors.required"),
            }),
        dueDate: z.date().optional(),
        notes: z.string().optional(),
        paymentMethodId: z.string().optional(),
        currency: z.string().optional(),
        discountRate: z
            .number({ invalid_type_error: t("invoices.upsert.form.discountRate.errors.required") })
            .min(0, t("invoices.upsert.form.discountRate.errors.min"))
            .max(100, t("invoices.upsert.form.discountRate.errors.max")),
        items: z.array(
            createItemSchema(t, "invoices", z.enum(['HOUR', 'DAY', 'DEPOSIT', 'SERVICE', 'PRODUCT']).optional()),
        ),
    })

    const recurringInvoiceSchema = z.object({
        quoteId: z.string().optional(),
        clientId: z
            .string()
            .min(1, t("recurringInvoices.upsert.form.client.errors.required"))
            .refine((val) => val !== "", {
                message: t("recurringInvoices.upsert.form.client.errors.required"),
            }),
        notes: z.string().optional(),
        paymentMethodId: z.string().optional(),
        frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "QUADMONTHLY", "SEMIANNUALLY", "ANNUALLY"], {
            errorMap: () => ({
                message: t("recurringInvoices.upsert.form.frequency.errors.required"),
            }),
        }),
        count: z.number().optional(),
        until: z.date().optional(),
        currency: z.string().optional(),
        autoSend: z.boolean().optional(),
        items: z.array(
            createItemSchema(t, "recurringInvoices", z.string()),
        ),
    })

    const [clientSearchTerm, setClientsSearchTerm] = useState("")
    const [quoteSearchTerm, setQuoteSearchTerm] = useState("")
    const [clientDialogOpen, setClientDialogOpen] = useState(false)
    const { data: clients } = useClientSearch(clientSearchTerm)
    const { data: quotes } = useQuoteSearch(quoteSearchTerm)
    const { data: paymentMethods } = usePaymentMethods()

    const { trigger: createTrigger } = usePost("/api/invoices")
    const { trigger: updateTrigger } = usePatch(`/api/invoices/${invoice?.id}`)
    const { trigger: createRecurringTrigger } = usePost("/api/recurring-invoices")

    const form = useForm<z.infer<typeof invoiceSchema>>({
        resolver: zodResolver(invoiceSchema),
        defaultValues: {
            quoteId: undefined,
            clientId: "",
            dueDate: undefined,
            paymentMethodId: "",
            currency: undefined,
            discountRate: 0,
            items: [],
            notes: "",
        },
    })

    const recurringForm = useForm<z.infer<typeof recurringInvoiceSchema>>({
        resolver: zodResolver(recurringInvoiceSchema),
        defaultValues: {
            quoteId: undefined,
            clientId: "",
            items: [],
            notes: "",
            frequency: "MONTHLY",
            autoSend: false,
        },
    })

    useEffect(() => {
        if (isEdit && invoice) {
            const inv: any = invoice as any;
            form.reset({
                quoteId: inv.quoteId || "",
                clientId: inv.clientId || "",
                dueDate: inv.dueDate ? new Date(inv.dueDate) : undefined,
                notes: inv.notes || "",
                paymentMethodId: inv.paymentMethodId || "",
                currency: inv.currency || "",
                discountRate: inv.discountRate ?? 0,
                items: (inv.items || [])
                    .sort((a: any, b: any) => a.order - b.order)
                    .map((item: any) => ({
                        id: item.id,
                        description: item.description || "",
                        quantity: item.quantity || 1,
                        unitPrice: item.unitPrice || 0,
                        vatRate: item.vatRate || 0,
                        type: item.type || 'SERVICE',
                        order: item.order || 0,
                    })),
            })
        } else {
            form.reset({
                quoteId: undefined,
                clientId: "",
                dueDate: undefined,
                notes: "",
                paymentMethodId: "",
                currency: undefined,
                discountRate: 0,
                items: [],
            })
            recurringForm.reset({
                quoteId: undefined,
                clientId: "",
                items: [],
                notes: "",
                frequency: "MONTHLY",
                autoSend: false,
            })
        }
    }, [invoice, form, recurringForm, isEdit])

    const { control, handleSubmit } = form
    const { control: recurringControl, handleSubmit: handleRecurringSubmit } = recurringForm

    const onSubmit = (data: z.infer<typeof invoiceSchema>) => {
        const trigger = isEdit ? updateTrigger : createTrigger

        trigger(data)
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
                form.reset()
            })
            .catch((err) => console.error(err))
    }

    const onSubmitRecurring = (data: z.infer<typeof recurringInvoiceSchema>) => {
        createRecurringTrigger(data)
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.recurringInvoices.listsAll() })
                onOpenChange(false)
                recurringForm.reset()
            })
            .catch((err) => console.error(err))
    }

    const handleClientCreate = (newClient: Client) => {
        setClientsSearchTerm("")
        clients?.push(newClient)
        if (mode === "invoice") {
            form.setValue("clientId", newClient.id)
            form.trigger("clientId")
        } else {
            recurringForm.setValue("clientId", newClient.id)
            recurringForm.trigger("clientId")
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="max-w-sm lg:max-w-4xl h-[85dvh] max-h-[85dvh] p-0 gap-0 flex flex-col overflow-hidden"
                    dataCy="invoice-dialog"
                >
                    <DialogHeader className="shrink-0 border-b px-6 py-4 space-y-3">
                        <DialogTitle>
                            {t(`invoices.upsert.title.${isEdit ? "edit" : "create"}`)}
                        </DialogTitle>
                        {!isEdit && (
                            <Tabs value={mode} onValueChange={(value) => setMode(value as CreationMode)}>
                                <TabsList>
                                    <TabsTrigger value="invoice" data-cy="invoice-tab-invoice">
                                        {t("invoices.upsert.tabs.invoice")}
                                    </TabsTrigger>
                                    <TabsTrigger value="recurring" data-cy="invoice-tab-recurring">
                                        {t("invoices.upsert.tabs.recurring")}
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        )}
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        {mode === "invoice" ? (
                            <Form {...form} key="invoice-form-mode">
                                <form id="invoice-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" data-cy="invoice-form">
                                    <FormField
                                        control={control}
                                        name="quoteId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("invoices.upsert.form.quote.label")}</FormLabel>
                                                <FormControl>
                                                    <SearchSelect
                                                        options={(quotes || []).map((c) => ({
                                                            label: `${c.number}${c.title ? ` (${c.title})` : ""}`,
                                                            value: c.id,
                                                        }))}
                                                        value={field.value ?? ""}
                                                        onValueChange={(val) => {
                                                            field.onChange(val || null)
                                                            if (val) {
                                                                const selectedQuote = quotes?.find((q) => q.id === val)
                                                                form.setValue("clientId", selectedQuote?.clientId || "")
                                                                form.setValue("notes", selectedQuote?.notes || "")
                                                                form.setValue("paymentMethodId", (selectedQuote as any)?.paymentMethodId || "")
                                                                form.setValue("currency", selectedQuote?.currency || "")
                                                                form.setValue("discountRate", selectedQuote?.discountRate ?? 0)
                                                                form.setValue('items', (selectedQuote?.items || []).map((item: any, index) => ({
                                                                    id: item.id,
                                                                    description: item.description || "",
                                                                    quantity: item.quantity || 1,
                                                                    unitPrice: item.unitPrice || 0,
                                                                    vatRate: item.vatRate || 0,
                                                                    type: item.type || 'SERVICE',
                                                                    order: index,
                                                                })))
                                                            }
                                                        }}
                                                        onSearchChange={setQuoteSearchTerm}
                                                        placeholder={t("invoices.upsert.form.quote.placeholder")}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <ClientSelectField
                                        translationPrefix="invoices"
                                        dataCy="invoice-client-select"
                                        clients={clients || []}
                                        onSearchChange={setClientsSearchTerm}
                                        onRequestCreateClient={() => setClientDialogOpen(true)}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="currency"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("invoices.upsert.form.currency.label")}</FormLabel>
                                                <FormControl>
                                                    <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy="invoice-currency-select" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name="discountRate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("invoices.upsert.form.discountRate.label")}</FormLabel>
                                                <FormControl>
                                                    <BetterInput
                                                        {...field}
                                                        defaultValue={field.value ?? 0}
                                                        postAdornment="%"
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={t("invoices.upsert.form.discountRate.placeholder")}
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value === ""
                                                                    ? 0
                                                                    : Number.parseFloat(e.target.value.replace(",", ".")),
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("invoices.upsert.form.discountRate.description")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name="dueDate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("invoices.upsert.form.dueDate.label")}</FormLabel>
                                                <FormControl>
                                                    <DatePicker
                                                        className="w-full"
                                                        value={field.value || null}
                                                        onChange={field.onChange}
                                                        placeholder={t("invoices.upsert.form.dueDate.placeholder")}
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
                                                <FormLabel>{t("invoices.upsert.form.notes.label")}</FormLabel>
                                                <FormControl>
                                                    <Textarea {...field} placeholder={t("invoices.upsert.form.notes.placeholder")} className="max-h-40" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name="paymentMethodId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("invoices.upsert.form.paymentMethod.label")}</FormLabel>
                                                <FormControl>
                                                    <Select value={field.value ?? ""} onValueChange={(val) => {
                                                        const v = val || "";
                                                        field.onChange(v);
                                                    }}>
                                                        <SelectTrigger className="w-full" aria-label={t("invoices.upsert.form.paymentMethod.label") as string}>
                                                            <SelectValue placeholder={t("invoices.upsert.form.paymentMethod.placeholder")} />
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
                                                    {t("invoices.upsert.form.paymentMethod.description")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />


                                    <InvoiceLineItemsEditor translationPrefix="invoices" defaultItemType="SERVICE" />
                                </form>
                            </Form>
                        ) : (
                            <Form {...recurringForm} key="recurring-form-mode">
                                <form id="recurring-invoice-form" onSubmit={handleRecurringSubmit(onSubmitRecurring)} className="space-y-4" data-cy="recurring-invoice-form">
                                    <FormField
                                        control={recurringControl}
                                        name="quoteId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("recurringInvoices.upsert.form.quote.label")}</FormLabel>
                                                <FormControl>
                                                    <SearchSelect
                                                        options={(quotes || []).map((c) => ({
                                                            label: `${c.number}${c.title ? ` (${c.title})` : ""}`,
                                                            value: c.id,
                                                        }))}
                                                        value={field.value ?? ""}
                                                        onValueChange={(val) => {
                                                            field.onChange(val || null)
                                                            if (val) {
                                                                const quote = quotes?.find((q) => q.id === val)
                                                                if (!quote) return
                                                                recurringForm.setValue("clientId", quote.clientId)
                                                                recurringForm.setValue("notes", quote.notes)
                                                                recurringForm.setValue("paymentMethodId", quote.paymentMethodId ?? quote.paymentMethod?.id ?? "")
                                                                recurringForm.setValue("currency", quote.currency || "")
                                                                recurringForm.setValue('items', quote.items.map((item) => ({
                                                                    id: item.id,
                                                                    type: item.type,
                                                                    description: item.description || "",
                                                                    quantity: item.quantity || 1,
                                                                    unitPrice: item.unitPrice || 0,
                                                                    vatRate: item.vatRate ?? 0,
                                                                    order: item.order || 0,
                                                                })))
                                                            }
                                                        }}
                                                        onSearchChange={setQuoteSearchTerm}
                                                        placeholder={t("recurringInvoices.upsert.form.quote.placeholder")}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <ClientSelectField
                                        translationPrefix="recurringInvoices"
                                        dataCy="recurring-invoice-client-select"
                                        clients={clients || []}
                                        onSearchChange={setClientsSearchTerm}
                                        onRequestCreateClient={() => setClientDialogOpen(true)}
                                    />

                                    <FormField
                                        control={recurringControl}
                                        name="currency"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("recurringInvoices.upsert.form.currency.label")}</FormLabel>
                                                <FormControl>
                                                    <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy="recurring-invoice-currency-select" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={recurringControl}
                                        name="notes"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("recurringInvoices.upsert.form.notes.label")}</FormLabel>
                                                <FormControl>
                                                    <Textarea {...field} placeholder={t("recurringInvoices.upsert.form.notes.placeholder")} className="max-h-40" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField
                                            control={recurringControl}
                                            name="paymentMethodId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel required>{t("recurringInvoices.upsert.form.paymentMethod.label")}</FormLabel>
                                                    <FormControl>
                                                        <Select value={field.value ?? ""} onValueChange={(val) => field.onChange(val || "")}>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder={t("recurringInvoices.upsert.form.paymentMethod.placeholder")} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {paymentMethods?.map((pm: PaymentMethod) => (
                                                                    <SelectItem key={pm.id} value={pm.id}>
                                                                        {pm.name} - {pm.type == PaymentMethodType.BANK_TRANSFER ? t("paymentMethods.fields.type.bank_transfer") : pm.type == PaymentMethodType.PAYPAL ? t("paymentMethods.fields.type.paypal") : pm.type == PaymentMethodType.CHECK ? t("paymentMethods.fields.type.check") : pm.type == PaymentMethodType.CASH ? t("paymentMethods.fields.type.cash") : pm.type == PaymentMethodType.OTHER ? t("paymentMethods.fields.type.other") : pm.type}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t("recurringInvoices.upsert.form.paymentMethod.description")}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </section>

                                    <Separator className="my-4" />

                                    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <FormField
                                            control={recurringControl}
                                            name="frequency"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel required>
                                                        {t("recurringInvoices.upsert.form.frequency.label")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Select value={field.value} onValueChange={field.onChange}>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder={t("recurringInvoices.upsert.form.frequency.placeholder")} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="WEEKLY">{t("recurringInvoices.frequency.weekly")}</SelectItem>
                                                                <SelectItem value="BIWEEKLY">{t("recurringInvoices.frequency.biweekly")}</SelectItem>
                                                                <SelectItem value="MONTHLY">{t("recurringInvoices.frequency.monthly")}</SelectItem>
                                                                <SelectItem value="BIMONTHLY">{t("recurringInvoices.frequency.bimonthly")}</SelectItem>
                                                                <SelectItem value="QUARTERLY">{t("recurringInvoices.frequency.quarterly")}</SelectItem>
                                                                <SelectItem value="QUADMONTHLY">{t("recurringInvoices.frequency.quadmonthly")}</SelectItem>
                                                                <SelectItem value="SEMIANNUALLY">{t("recurringInvoices.frequency.semiannually")}</SelectItem>
                                                                <SelectItem value="ANNUALLY">{t("recurringInvoices.frequency.annually")}</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormMessage />
                                                    <FormDescription>
                                                        {t("recurringInvoices.upsert.form.frequency.description")}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={recurringControl}
                                            name="count"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("recurringInvoices.upsert.form.count.label")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <BetterInput
                                                            {...field}
                                                            type="number"
                                                            placeholder={t("recurringInvoices.upsert.form.count.placeholder")}
                                                            onChange={(e) =>
                                                                field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                    <FormDescription>
                                                        {t("recurringInvoices.upsert.form.count.description")}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={recurringControl}
                                            name="until"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("recurringInvoices.upsert.form.until.label")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <DatePicker
                                                            {...field}
                                                            className="w-full"
                                                            placeholder={t("recurringInvoices.upsert.form.until.placeholder")}
                                                            value={field.value || null}
                                                            onChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                    <FormDescription>
                                                        {t("recurringInvoices.upsert.form.until.description")}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                    </section>

                                    <Separator className="my-4" />

                                    <InvoiceLineItemsEditor translationPrefix="recurringInvoices" defaultItemType="HOUR" />

                                    <Separator className="my-4" />

                                    <FormField
                                        control={recurringControl}
                                        name="autoSend"
                                        render={({ field }) => (
                                            <FormItem className="mt-4">
                                                <Switch
                                                    id="autoSend"
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                                <FormLabel className="ml-2" htmlFor="autoSend">
                                                    {t("recurringInvoices.upsert.form.autoSend.label")}
                                                </FormLabel>
                                                <FormDescription>
                                                    {t("recurringInvoices.upsert.form.autoSend.description")}
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                </form>
                            </Form>
                        )}
                    </div>

                    <div className="shrink-0 border-t px-6 py-4 flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t("invoices.upsert.actions.cancel")}
                        </Button>
                        <Button
                            type="submit"
                            form={mode === "invoice" ? "invoice-form" : "recurring-invoice-form"}
                            dataCy="invoice-submit"
                        >
                            {mode === "invoice"
                                ? t(`invoices.upsert.actions.${isEdit ? "save" : "create"}`)
                                : t("recurringInvoices.upsert.actions.create")}
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

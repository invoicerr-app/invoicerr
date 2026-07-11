import type { Client, PaymentMethod, Quote, RecurringInvoice } from "@/types"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState } from "react"
import { useGet } from "@/hooks/use-fetch"
import { useDocumentUpsert } from "@/hooks/use-document-upsert"
import { createLineItemSchema } from "@/lib/line-item-schema"

import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { ClientSelectField } from "@/components/document-form/client-select-field"
import { ClientUpsert } from "../../../clients/_components/client-upsert"
import { CurrencyField } from "@/components/document-form/currency-field"
import { DatePicker } from "@/components/date-picker"
import { LineItemsEditor } from "@/components/document-form/line-items-editor"
import { PaymentMethodField } from "@/components/document-form/payment-method-field"
import SearchSelect from "@/components/search-input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "react-i18next"
import { z } from "zod"

interface RecurringInvoiceUpsertDialogProps {
  recurringInvoice?: RecurringInvoice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecurringInvoiceUpsert({
  recurringInvoice,
  open,
  onOpenChange,
}: RecurringInvoiceUpsertDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!recurringInvoice

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
    frequency: z.enum(
      ["WEEKLY", "BIWEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "QUADMONTHLY", "SEMIANNUALLY", "ANNUALLY"],
      {
        errorMap: () => ({
          message: t("recurringInvoices.upsert.form.frequency.errors.required"),
        }),
      },
    ),
    count: z.number().optional(),
    until: z.date().optional(),
    currency: z.string().optional(),
    autoIssue: z.boolean().optional(),
    autoSend: z.boolean().optional(),
    items: z.array(createLineItemSchema(t, "recurringInvoices", z.string())),
  })

  const [clientSearchTerm, setClientsSearchTerm] = useState("")
  const [quoteSearchTerm, setQuoteSearchTerm] = useState("")
  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const { data: clients } = useGet<Client[]>(`/api/clients/search?query=${clientSearchTerm}`)
  const { data: quotes } = useGet<Quote[]>(`/api/quotes/search?query=${quoteSearchTerm}`)
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`)

  const { form, submit, submitLoading } = useDocumentUpsert({
    entity: recurringInvoice,
    schema: recurringInvoiceSchema,
    defaultValues: {
      quoteId: undefined,
      clientId: "",
      items: [],
      notes: "",
      frequency: "MONTHLY",
      autoIssue: false,
      autoSend: false,
    },
    createUrl: "/api/recurring-invoices",
    updateUrl: `/api/recurring-invoices/${recurringInvoice?.id}`,
    errorMessage: t("recurringInvoices.upsert.messages.saveError", "Failed to save recurring invoice"),
    mapEntityToForm: (recurringInvoice) => ({
      notes: recurringInvoice.notes || "",
      paymentMethodId: (recurringInvoice.paymentMethodId ?? recurringInvoice.paymentMethod?.id) || "",
      frequency: recurringInvoice.frequency || "MONTHLY",
      count: recurringInvoice.count,
      until: recurringInvoice.until ? new Date(recurringInvoice.until) : undefined,
      autoIssue: recurringInvoice.autoIssue || false,
      autoSend: recurringInvoice.autoSend || false,
      items: recurringInvoice.items
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

  const handleClose = (open: boolean) => {
    onOpenChange(!!open)
    form.reset()
  }

  const handleClientCreate = (newClient: Client) => {
    setClientsSearchTerm("")
    form.setValue("clientId", newClient.id)
    clients?.push(newClient)
    form.trigger("clientId")
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden"
          dataCy="recurring-invoice-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t(`recurringInvoices.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={handleSubmit(submit)}
              className="space-y-4 overflow-auto mt-2 flex-1"
              data-cy="recurring-invoice-form"
            >
              <FormField
                control={control}
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
                            form.setValue("clientId", quote.clientId)
                            form.setValue("notes", quote.notes)
                            form.setValue(
                              "paymentMethodId",
                              quote.paymentMethodId ?? quote.paymentMethod?.id ?? "",
                            )
                            form.setValue("currency", quotes?.find((q) => q.id === val)?.currency || "")
                            form.setValue(
                              "items",
                              quote.items.map((item) => ({
                                id: item.id,
                                type: item.type,
                                name: item.name || "",
                                description: item.description || "",
                                quantity: item.quantity || 1,
                                unitPrice: item.unitPrice || 0,
                                vatRate: item.vatRate ?? 0,
                                order: item.order || 0,
                              })),
                            )
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

              <CurrencyField
                translationPrefix="recurringInvoices"
                dataCy="recurring-invoice-currency-select"
              />

              <FormField
                control={control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("recurringInvoices.upsert.form.notes.label")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t("recurringInvoices.upsert.form.notes.placeholder")}
                        className="max-h-40"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PaymentMethodField
                  translationPrefix="recurringInvoices"
                  paymentMethods={paymentMethods}
                  required
                />
              </section>

              <Separator className="my-4" />

              <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={control}
                  name="frequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("recurringInvoices.upsert.form.frequency.label")}</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("recurringInvoices.upsert.form.frequency.placeholder")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="WEEKLY">{t("recurringInvoices.frequency.weekly")}</SelectItem>
                            <SelectItem value="BIWEEKLY">
                              {t("recurringInvoices.frequency.biweekly")}
                            </SelectItem>
                            <SelectItem value="MONTHLY">
                              {t("recurringInvoices.frequency.monthly")}
                            </SelectItem>
                            <SelectItem value="BIMONTHLY">
                              {t("recurringInvoices.frequency.bimonthly")}
                            </SelectItem>
                            <SelectItem value="QUARTERLY">
                              {t("recurringInvoices.frequency.quarterly")}
                            </SelectItem>
                            <SelectItem value="QUADMONTHLY">
                              {t("recurringInvoices.frequency.quadmonthly")}
                            </SelectItem>
                            <SelectItem value="SEMIANNUALLY">
                              {t("recurringInvoices.frequency.semiannually")}
                            </SelectItem>
                            <SelectItem value="ANNUALLY">
                              {t("recurringInvoices.frequency.annually")}
                            </SelectItem>
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
                  control={control}
                  name="count"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("recurringInvoices.upsert.form.count.label")}</FormLabel>
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
                  control={control}
                  name="until"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("recurringInvoices.upsert.form.until.label")}</FormLabel>
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

              <LineItemsEditor translationPrefix="recurringInvoices" defaultItemType="HOUR" />

              <Separator className="my-4" />

              <FormField
                control={control}
                name="autoIssue"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <Switch id="autoIssue" checked={field.value} onCheckedChange={field.onChange} />
                    <FormLabel className="ml-2" htmlFor="autoIssue">
                      {t("recurringInvoices.upsert.form.autoIssue.label")}
                    </FormLabel>
                    <FormDescription>
                      {t("recurringInvoices.upsert.form.autoIssue.description")}
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="autoSend"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <Switch id="autoSend" checked={field.value} onCheckedChange={field.onChange} />
                    <FormLabel className="ml-2" htmlFor="autoSend">
                      {t("recurringInvoices.upsert.form.autoSend.label")}
                    </FormLabel>
                    <FormDescription>
                      {t("recurringInvoices.upsert.form.autoSend.description")}
                    </FormDescription>
                  </FormItem>
                )}
              />

              <DialogFooter className="flex justify-end">
                <Button variant="outline" onClick={() => handleClose(false)}>
                  {t("recurringInvoices.upsert.actions.cancel")}
                </Button>
                <Button type="submit" loading={submitLoading} dataCy="recurring-invoice-submit">
                  {t(`recurringInvoices.upsert.actions.${isEdit ? "save" : "create"}`)}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ClientUpsert
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        onCreate={handleClientCreate} // Gestion du client créé
      />
    </>
  )
}

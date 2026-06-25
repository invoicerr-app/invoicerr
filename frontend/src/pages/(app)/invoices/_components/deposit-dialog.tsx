import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import { usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { ClientSelectField } from "./client-select-field"
import { useState } from "react"
import { useClientSearch } from "@/hooks/queries"
import { ClientUpsert } from "../../clients/_components/client-upsert"
import type { Client } from "@/types"

interface DepositDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultClientId?: string
    defaultCurrency?: string
}

export function DepositDialog({ open, onOpenChange, defaultClientId, defaultCurrency }: DepositDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { trigger: createDeposit } = usePost("/api/invoices/deposit")

    const [clientSearchTerm, setClientsSearchTerm] = useState("")
    const { data: clients } = useClientSearch(clientSearchTerm)
    const [showClientCreate, setShowClientCreate] = useState(false)

    const depositSchema = z.object({
        clientId: z.string().min(1, t("invoices.upsert.form.client.errors.required")),
        amount: z.number({ invalid_type_error: t("invoices.deposit.form.amount.errors.required") })
            .min(0.01, t("invoices.deposit.form.amount.errors.min")),
        currency: z.string().optional(),
        notes: z.string().optional(),
    })

    const form = useForm<z.infer<typeof depositSchema>>({
        resolver: zodResolver(depositSchema),
        defaultValues: {
            clientId: defaultClientId || "",
            amount: 0,
            currency: defaultCurrency || "EUR",
            notes: "",
        },
    })

    const onSubmit = (data: z.infer<typeof depositSchema>) => {
        createDeposit({ ...data, kind: 'DEPOSIT' })
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                toast.success(t("invoices.deposit.messages.success"))
                onOpenChange(false)
                form.reset()
            })
            .catch((err) => {
                toast.error(t("invoices.deposit.messages.error"))
                console.error(err)
            })
    }

    const handleClientCreate = (newClient: Client) => {
        setClientsSearchTerm("")
        clients?.push(newClient)
        form.setValue("clientId", newClient.id)
        form.trigger("clientId")
        setShowClientCreate(false)
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-md" dataCy="deposit-dialog">
                    <DialogHeader>
                        <DialogTitle>{t("invoices.deposit.title")}</DialogTitle>
                        <DialogDescription>{t("invoices.deposit.description")}</DialogDescription>
                    </DialogHeader>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-cy="deposit-form">
                            <FormField
                                control={form.control}
                                name="clientId"
                                render={({ field }) => (
                                    <ClientSelectField
                                        field={field}
                                        searchTerm={clientSearchTerm}
                                        setSearchTerm={setClientsSearchTerm}
                                        onCreateClient={() => setShowClientCreate(true)}
                                        clients={clients}
                                    />
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("invoices.deposit.form.amount.label")}</FormLabel>
                                        <FormControl>
                                            <BetterInput
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                placeholder={t("invoices.deposit.form.amount.placeholder")}
                                                {...field}
                                                value={field.value ?? ""}
                                                onChange={(e) => field.onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                                                data-cy="deposit-amount"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("invoices.upsert.form.notes.label")}</FormLabel>
                                        <FormControl>
                                            <BetterInput
                                                placeholder={t("invoices.deposit.form.notes.placeholder")}
                                                {...field}
                                                value={field.value ?? ""}
                                                data-cy="deposit-notes"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                    {t("invoices.upsert.actions.cancel")}
                                </Button>
                                <Button type="submit" data-cy="deposit-submit">
                                    {t("invoices.deposit.actions.create")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <ClientUpsert
                open={showClientCreate}
                onOpenChange={setShowClientCreate}
                onClientCreated={handleClientCreate}
            />
        </>
    )
}

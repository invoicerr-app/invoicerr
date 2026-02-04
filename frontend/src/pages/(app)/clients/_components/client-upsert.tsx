import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePatch, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import type { Client } from "@/types"
import CurrencySelect from "@/components/currency-select"
import { DatePicker } from "@/components/date-picker"
import { Input } from "@/components/ui/input"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface ClientUpsertProps {
    client?: Client | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreate?: (client: Client) => void
}

export function ClientUpsert({ client, open, onOpenChange, onCreate }: ClientUpsertProps) {
    const { t } = useTranslation()
    const isEditing = !!client

    const { trigger: createClient } = usePost("/api/clients")
    const { trigger: updateClient } = usePatch(`/api/clients/${client?.id}`)

    const clientSchema = z.object({
        type: z.enum(['INDIVIDUAL', 'COMPANY']),
        name: z.string().optional(),
        description: z.string().max(500, t("clients.upsert.validation.description.maxLength")).optional(),
        legalId: z.string().max(50, t("clients.upsert.validation.legalId.maxLength")).optional(),
        VAT: z
            .string()
            .max(15, t("clients.upsert.validation.vat.maxLength"))
            .optional()
            .refine((val) => {
                if (!val) return true // Skip validation if VAT is not provided
                return /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(val)
            }, t("clients.upsert.validation.vat.format")),
        currency: z.string().nullable().optional(),
        foundedAt: z.date().optional().refine((date) => !date || date <= new Date(), t("clients.upsert.validation.foundedAt.future")),
        contactFirstname: z.string().optional(),
        contactLastname: z.string().optional(),
        contactPhone: z
            .string()
            .optional()
            .refine((val) => {
                if (!val) return true;
                return /^[+]?[0-9\s\-()]{8,20}$/.test(val)
            }, t("clients.upsert.validation.contactPhone.format")),
        contactEmail: z
            .string()
            .min(1, t("clients.upsert.validation.contactEmail.required"))
            .refine((val) => {
                if (!val) return true;
                return z.string().email().safeParse(val).success
            }, t("clients.upsert.validation.contactEmail.format")),
        address: z.string().min(1, t("clients.upsert.validation.address.required")),
        addressLine2: z.string().optional(),
        postalCode: z.string().refine((val) => {
            return /^[0-9A-Z\s-]{3,10}$/.test(val)
        }, t("clients.upsert.validation.postalCode.format")),
        city: z.string().min(1, t("clients.upsert.validation.city.required")),
        state: z.string().optional(),
        country: z.string().min(1, t("clients.upsert.validation.country.required")),
    }).superRefine((val, ctx) => {
        if (val.type === 'INDIVIDUAL') {
            if (!val.contactFirstname || val.contactFirstname.trim() === '') {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactFirstname'], message: t("clients.upsert.validation.contactFirstname.required") || "First name is required for individuals" })
            }
            if (!val.contactLastname || val.contactLastname.trim() === '') {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactLastname'], message: t("clients.upsert.validation.contactLastname.required") || "Last name is required for individuals" })
            }
        } else {
            if (!val.name || val.name.trim() === '') {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: t("clients.upsert.validation.name.required") })
            }
            if (!val.legalId || val.legalId.trim() === '') {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['legalId'], message: t("clients.upsert.validation.legalId.required") || "SIRET is required for companies" })
            }
        }
    })

    const form = useForm<z.infer<typeof clientSchema>>({
        resolver: zodResolver(clientSchema),
        defaultValues: {
            type: 'COMPANY',
            name: "",
            description: "",
            legalId: "",
            VAT: "",
            currency: null,
            foundedAt: new Date(),
            contactFirstname: "",
            contactLastname: "",
            contactPhone: "",
            contactEmail: "",
            address: "",
            addressLine2: "",
            postalCode: "",
            city: "",
            state: "",
            country: "",
        },
    })

    // watch the selected client type to conditionally render company-specific fields
    const clientType = form.watch("type")

    useEffect(() => {
        if (isEditing && client) {
            const c: any = client as any;
            form.reset({
                type: c.type || 'COMPANY',
                name: c.name || "",
                description: c.description || "",
                legalId: c.legalId || "",
                VAT: c.VAT || "",
                currency: c.currency || null,
                foundedAt: c.foundedAt ? new Date(c.foundedAt) : undefined,
                contactFirstname: c.contactFirstname || "",
                contactLastname: c.contactLastname || "",
                contactPhone: c.contactPhone || "",
                contactEmail: c.contactEmail || "",
                address: c.address || "",
                addressLine2: c.addressLine2 || "",
                postalCode: c.postalCode || "",
                city: c.city || "",
                state: c.state || "",
                country: c.country || "",
            })
        } else if (!isEditing) {
            form.reset({
                type: 'COMPANY',
                name: "",
                description: "",
                legalId: "",
                VAT: "",
                currency: null,
                foundedAt: undefined,
                contactFirstname: "",
                contactLastname: "",
                contactPhone: "",
                contactEmail: "",
                address: "",
                addressLine2: "",
                postalCode: "",
                city: "",
                state: "",
                country: "",
            })
        }
    }, [client, isEditing, form])

    const onSubmit = (data: z.infer<typeof clientSchema>) => {
        const trigger = isEditing ? updateClient : createClient

        trigger(data)
            .then((createdClient) => {
                if (!isEditing && onCreate) {
                    onCreate(createdClient)
                }
                onOpenChange(false)
                form.reset()
            })
            .catch((err) => console.error(err))
    }

    return (
        <Dialog open={open} onOpenChange={(status) => { form.reset(); onOpenChange(status); }}>
            <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden" dataCy="client-dialog">
                <div className="flex-1 overflow-auto">
                    <DialogHeader>
                        <DialogTitle>{t(`clients.upsert.title.${isEditing ? "edit" : "create"}`)}</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4" data-cy="client-form">

                            <FormField
                                control={form.control}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("clients.upsert.fields.type.label") || "Client type"}</FormLabel>
                                        <FormControl>
                                            <Select value={field.value || "COMPANY"} onValueChange={(value) => field.onChange(value)}>
                                                <SelectTrigger dataCy="client-type-select">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="COMPANY" dataCy="client-type-company">
                                                        {t("clients.upsert.fields.type.company") || "Company"}
                                                    </SelectItem>
                                                    <SelectItem value="INDIVIDUAL" dataCy="client-type-individual">
                                                        {t("clients.upsert.fields.type.individual") || "Individual"}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />


                            {clientType === 'COMPANY' ? (
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("clients.upsert.fields.name.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.name.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="contactFirstname"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("clients.upsert.fields.contactFirstname.label")}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder={t("clients.upsert.fields.contactFirstname.placeholder")} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="contactLastname"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("clients.upsert.fields.contactLastname.label")}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder={t("clients.upsert.fields.contactLastname.placeholder")} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("clients.upsert.fields.description.label")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t("clients.upsert.fields.description.placeholder")} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {clientType === 'COMPANY' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="legalId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel required>{t("clients.upsert.fields.legalId.label")}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder={t("clients.upsert.fields.legalId.placeholder")} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="VAT"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("clients.upsert.fields.vat.label")}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder={t("clients.upsert.fields.vat.placeholder")} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="currency"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("clients.upsert.fields.currency.label")}</FormLabel>
                                            <FormControl>
                                                <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy="client-currency-select" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="foundedAt"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("clients.upsert.fields.foundedAt.label")}</FormLabel>
                                            <FormControl>
                                                <DatePicker
                                                    className="w-full"
                                                    value={field.value || null}
                                                    onChange={field.onChange}
                                                    placeholder={t("clients.upsert.fields.foundedAt.placeholder")}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="contactEmail"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel required>{t("clients.upsert.fields.contactEmail.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.contactEmail.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="contactPhone"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("clients.upsert.fields.contactPhone.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.contactPhone.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="address"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel required>{t("clients.upsert.fields.address.label")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t("clients.upsert.fields.address.placeholder")} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="addressLine2"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("clients.upsert.fields.addressLine2.label")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t("clients.upsert.fields.addressLine2.placeholder")} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField
                                    control={form.control}
                                    name="postalCode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel required>{t("clients.upsert.fields.postalCode.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.postalCode.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="city"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel required>{t("clients.upsert.fields.city.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.city.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("clients.upsert.fields.state.label")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.state.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="country"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel required>{t("clients.upsert.fields.country.label")}</FormLabel>
                                        <FormControl>
                                                <Input {...field} placeholder={t("clients.upsert.fields.country.placeholder")} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="flex justify-end space-x-2">
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} dataCy="client-cancel">
                                    {t("clients.upsert.actions.cancel")}
                                </Button>
                                <Button type="submit" dataCy="client-submit">
                                    {isEditing ? t("clients.upsert.actions.save") : t("clients.upsert.actions.create")}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    )
}

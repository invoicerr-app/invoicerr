import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import type { Client } from "@/types"
import CountrySelect from "@/components/country-select"
import CurrencySelect from "@/components/currency-select"
import { DatePicker } from "@/components/date-picker"
import { Input } from "@/components/ui/input"
import { Loader2, Search } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useLookupSiret } from "@/hooks/use-lookup-siret"
import { useCountryToCurrency } from "@/hooks/use-country-to-currency"
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers"
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
    const queryClient = useQueryClient()

    const { trigger: createClient } = usePost("/api/clients")
    const { trigger: updateClient } = usePatch(`/api/clients/${client?.id}`)

    const clientSchema = z.object({
        type: z.enum(['INDIVIDUAL', 'COMPANY']),
        name: z.string().optional(),
        description: z.string().max(500, t("clients.upsert.validation.description.maxLength")).optional(),
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
        countryCode: z.string().optional(),
        identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
        // Peppol / electronic routing (stored as PEPPOL_ENDPOINT party identifier)
        peppolSchemeId: z.string().optional(),
        peppolEndpointId: z.string().optional(),
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
        }
    })

    const form = useForm<z.infer<typeof clientSchema>>({
        resolver: zodResolver(clientSchema),
        defaultValues: {
            type: 'COMPANY',
            name: "",
            description: "",
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
            countryCode: "",
            identifiers: [],
            peppolSchemeId: "0088",
            peppolEndpointId: "",
        },
    })

    // watch the selected client type to conditionally render company-specific fields
    const clientType = form.watch("type")

    useEffect(() => {
        if (isEditing && client) {
            const c: any = client as any;
            // Parse Peppol endpoint from partyIdentifiers (format: 'schemeId:value')
            const peppolEntry = (c.partyIdentifiers || []).find((pi: any) => pi.scheme === 'PEPPOL_ENDPOINT');
            const peppolRaw: string = peppolEntry?.value || '';
            const colonIdx = peppolRaw.indexOf(':');
            const parsedPeppolSchemeId = colonIdx >= 0 ? peppolRaw.slice(0, colonIdx) : '0088';
            const parsedPeppolEndpointId = colonIdx >= 0 ? peppolRaw.slice(colonIdx + 1) : '';
            form.reset({
                type: c.type || 'COMPANY',
                name: c.name || "",
                description: c.description || "",
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
                countryCode: c.countryCode || "",
                identifiers: (c.partyIdentifiers || [])
                    .filter((pi: any) => pi.scheme !== 'PEPPOL_ENDPOINT')
                    .map((pi: any) => ({ scheme: pi.scheme, value: pi.value })),
                peppolSchemeId: parsedPeppolSchemeId,
                peppolEndpointId: parsedPeppolEndpointId,
            })
        } else if (!isEditing) {
            form.reset({
                type: 'COMPANY',
                name: "",
                description: "",
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
                countryCode: "",
                identifiers: [],
                peppolSchemeId: "0088",
                peppolEndpointId: "",
            })
        }
    }, [client, isEditing, form])

    const identifiers = form.watch("identifiers") || []
    const legalIdEntry = identifiers.find((i: any) => i.scheme === "LEGAL_ID")
    const legalIdValue = legalIdEntry?.value || ""
    const countryValue = form.watch("country")
    const isFranceOrUnset = !countryValue || /^fr(ance)?$/i.test(countryValue.trim())

    const { lookup: onLookupSiret, isLoading: siretLookupLoading } = useLookupSiret(form, {
        messages: {
            invalid: t("clients.upsert.messages.siretInvalid"),
            notFound: t("clients.upsert.messages.siretNotFound"),
            success: t("clients.upsert.messages.siretSuccess"),
            error: t("clients.upsert.messages.siretError"),
        },
    })
    useCountryToCurrency(form)

    const countryCodeValue = form.watch("countryCode")
    const clientTypeWatch = form.watch("type")
    const { data: requiredIdentifiers } = useRequiredIdentifiers(
        countryCodeValue || undefined,
        clientTypeWatch === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
    )

    // Sync identifier fields with what the country requires
    useEffect(() => {
        if (!requiredIdentifiers) return
        const requiredSchemes = new Set(requiredIdentifiers.map((r) => r.scheme))
        const current: { scheme: string; value: string }[] = form.getValues("identifiers") || []
        const formSchemes = new Set(current.map((i) => i.scheme))
        const next = [...current]
        let changed = false
        for (const scheme of requiredSchemes) {
            if (!formSchemes.has(scheme)) {
                next.push({ scheme, value: "" })
                changed = true
            }
        }
        for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].scheme && !requiredSchemes.has(next[i].scheme)) {
                next.splice(i, 1)
                changed = true
            }
        }
        if (changed) {
            form.setValue("identifiers", next)
        }
    }, [requiredIdentifiers, form])

    const isSiretLookupDisabled = siretLookupLoading || !legalIdValue || legalIdValue.replace(/\D/g, '').length !== 14

    const onSubmit = (data: z.infer<typeof clientSchema>) => {
        if (requiredIdentifiers) {
            for (const req of requiredIdentifiers) {
                if (req.required) {
                    const val = (data.identifiers || []).find((i) => i.scheme === req.scheme)?.value
                    if (!val || val.trim() === '') {
                        const idx = (data.identifiers || []).findIndex((i) => i.scheme === req.scheme)
                        form.setError(`identifiers.${idx}.value` as any, { message: `${req.label} is required` })
                        return
                    }
                }
            }
        }

        const trigger = isEditing ? updateClient : createClient

        // Merge Peppol endpoint into identifiers (stored as PEPPOL_ENDPOINT party identifier)
        const peppolEntry = data.peppolSchemeId && data.peppolEndpointId?.trim()
            ? { scheme: 'PEPPOL_ENDPOINT', value: `${data.peppolSchemeId}:${data.peppolEndpointId.trim()}` }
            : null;
        const { peppolSchemeId: _ps, peppolEndpointId: _pe, ...dataWithoutPeppol } = data;
        // Filter out empty identifiers so we don't send {scheme, value: ""}
        const payload = {
            ...dataWithoutPeppol,
            identifiers: [
                ...(data.identifiers || []).filter((i) => i.value.trim() !== ""),
                ...(peppolEntry ? [peppolEntry] : []),
            ],
        }

        trigger(payload)
            .then((createdClient) => {
                queryClient.invalidateQueries({ queryKey: queryKeys.clients.listsAll() })
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
                                name="country"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel required>{t("clients.upsert.fields.country.label")}</FormLabel>
                                        <FormControl>
                                            <CountrySelect value={field.value} onChange={(value) => field.onChange(value)} onCountryCodeChange={(code) => form.setValue('countryCode', code)} data-cy="client-country-select" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

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

                            {requiredIdentifiers?.length ? (
                                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                                    <p className="text-sm font-medium text-muted-foreground">{t("clients.upsert.fields.identifiers.label") || "Country-specific identifiers"}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {requiredIdentifiers.map((req) => {
                                            const current = form.watch("identifiers") || []
                                            const formIndex = current.findIndex((i: any) => i.scheme === req.scheme)
                                            if (formIndex < 0) return null
                                            const isLegalId = req.scheme === "LEGAL_ID"
                                            return (
                                                <FormField
                                                    key={req.scheme}
                                                    control={form.control}
                                                    name={`identifiers.${formIndex}.value`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel required={req.required}>{req.label}</FormLabel>
                                                            <FormControl>
                                                                <div className="flex gap-2">
                                                                    <Input {...field} placeholder={req.label} data-cy={`client-identifier-${req.scheme}`} />
                                                                    {isLegalId && isFranceOrUnset && (
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="icon"
                                                                            disabled={isSiretLookupDisabled}
                                                                            onClick={() => onLookupSiret(legalIdValue)}
                                                                            title={t("clients.upsert.actions.lookupSiret")}
                                                                            dataCy="client-siret-lookup"
                                                                        >
                                                                            {siretLookupLoading ? <Loader2 className="animate-spin" /> : <Search />}
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </FormControl>
                                                            {req.helpText && (
                                                                <p className="text-xs text-muted-foreground">{req.helpText}</p>
                                                            )}
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : null}

                            {/* Peppol / Electronic routing section */}
                            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                                <p className="text-sm font-medium text-muted-foreground">
                                    {t("clients.upsert.fields.peppol.label") || "Peppol / Electronic routing (optional)"}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="peppolSchemeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("clients.upsert.fields.peppolSchemeId.label") || "Peppol scheme"}</FormLabel>
                                                <FormControl>
                                                    <Select value={field.value || "0088"} onValueChange={field.onChange}>
                                                        <SelectTrigger data-cy="client-peppol-scheme-select">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0088">0088 — GLN</SelectItem>
                                                            <SelectItem value="0192">0192 — NO org.nr</SelectItem>
                                                            <SelectItem value="0009">0009 — FR SIRET</SelectItem>
                                                            <SelectItem value="9925">9925 — EU VAT</SelectItem>
                                                            <SelectItem value="0007">0007 — SE org.nr</SelectItem>
                                                            <SelectItem value="0208">0208 — BE org.nr</SelectItem>
                                                            <SelectItem value="0106">0106 — DK CVR</SelectItem>
                                                            <SelectItem value="0151">0151 — AU ABN</SelectItem>
                                                            <SelectItem value="0060">0060 — DUNS</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="peppolEndpointId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("clients.upsert.fields.peppolEndpointId.label") || "Peppol endpoint ID"}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        placeholder={t("clients.upsert.fields.peppolEndpointId.placeholder") || "e.g. 7300010000001"}
                                                        data-cy="client-peppol-endpoint-input"
                                                    />
                                                </FormControl>
                                                <p className="text-xs text-muted-foreground">
                                                    {t("clients.upsert.fields.peppolEndpointId.helpText") || "Leave blank if this client is not on the Peppol network"}
                                                </p>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

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

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
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
import { type LookupScheme, useCompanyLookup } from "@/hooks/use-company-lookup"
import { useCountryToCurrency } from "@/hooks/use-country-to-currency"
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers"
import { useB2gRoutingRule } from "@/hooks/use-b2g-routing"
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

  const saveErrorMessage = t("clients.upsert.messages.saveError", "Failed to save client")
  const { trigger: createClient, loading: createLoading } = useMutationWithToast(
    usePost("/api/clients"),
    saveErrorMessage,
  )
  const { trigger: updateClient, loading: updateLoading } = useMutationWithToast(
    usePatch(`/api/clients/${client?.id}`),
    saveErrorMessage,
  )

  const clientSchema = z
    .object({
      type: z.enum(["INDIVIDUAL", "COMPANY"]),
      // B2G routing (documents/b2g-routing/) — GOVERNMENT changes which channel/format an invoice to
      // this client must use, per its own country (see the B2G hint panel further down this form).
      kind: z.enum(["BUSINESS", "GOVERNMENT"]),
      name: z.string().optional(),
      description: z.string().max(500, t("clients.upsert.validation.description.maxLength")).optional(),
      currency: z.string().nullable().optional(),
      foundedAt: z
        .date()
        .optional()
        .refine((date) => !date || date <= new Date(), t("clients.upsert.validation.foundedAt.future")),
      contactFirstname: z.string().optional(),
      contactLastname: z.string().optional(),
      contactPhone: z
        .string()
        .optional()
        .refine((val) => {
          if (!val) return true
          return /^[+]?[0-9\s\-()]{8,20}$/.test(val)
        }, t("clients.upsert.validation.contactPhone.format")),
      contactEmail: z
        .string()
        .min(1, t("clients.upsert.validation.contactEmail.required"))
        .refine((val) => {
          if (!val) return true
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
    })
    .superRefine((val, ctx) => {
      if (val.type === "INDIVIDUAL") {
        if (!val.contactFirstname || val.contactFirstname.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactFirstname"],
            message:
              t("clients.upsert.validation.contactFirstname.required") ||
              "First name is required for individuals",
          })
        }
        if (!val.contactLastname || val.contactLastname.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactLastname"],
            message:
              t("clients.upsert.validation.contactLastname.required") ||
              "Last name is required for individuals",
          })
        }
      } else {
        if (!val.name || val.name.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("clients.upsert.validation.name.required"),
          })
        }
      }
    })

  const form = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      type: "COMPANY",
      kind: "BUSINESS",
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
      // Parse Peppol endpoint from partyIdentifiers (format: 'schemeId:value')
      const peppolEntry = (client.partyIdentifiers || []).find((pi) => pi.scheme === "PEPPOL_ENDPOINT")
      const peppolRaw: string = peppolEntry?.value || ""
      const colonIdx = peppolRaw.indexOf(":")
      const parsedPeppolSchemeId = colonIdx >= 0 ? peppolRaw.slice(0, colonIdx) : "0088"
      const parsedPeppolEndpointId = colonIdx >= 0 ? peppolRaw.slice(colonIdx + 1) : ""
      form.reset({
        type: client.type || "COMPANY",
        kind: client.kind || "BUSINESS",
        name: client.name || "",
        description: client.description || "",
        currency: client.currency || null,
        foundedAt: client.foundedAt ? new Date(client.foundedAt) : undefined,
        contactFirstname: client.contactFirstname || "",
        contactLastname: client.contactLastname || "",
        contactPhone: client.contactPhone || "",
        contactEmail: client.contactEmail || "",
        address: client.address || "",
        addressLine2: client.addressLine2 || "",
        postalCode: client.postalCode || "",
        city: client.city || "",
        state: client.state || "",
        country: client.country || "",
        countryCode: client.countryCode || "",
        identifiers: (client.partyIdentifiers || [])
          .filter((pi) => pi.scheme !== "PEPPOL_ENDPOINT")
          .map((pi) => ({ scheme: pi.scheme, value: pi.value })),
        peppolSchemeId: parsedPeppolSchemeId,
        peppolEndpointId: parsedPeppolEndpointId,
      })
    } else if (!isEditing) {
      form.reset({
        type: "COMPANY",
        kind: "BUSINESS",
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

  const {
    lookup: onCompanyLookup,
    isLoading: companyLookupLoading,
    isAvailable: canLookupCompany,
    schemes: lookupSchemes,
    identifierLabel: lookupIdentifierLabel,
  } = useCompanyLookup(form, {
    countryCode: form.watch("countryCode"),
    messages: {
      invalid: t("clients.upsert.messages.lookupInvalid"),
      notFound: t("clients.upsert.messages.lookupNotFound"),
      success: t("clients.upsert.messages.lookupSuccess"),
      error: t("clients.upsert.messages.lookupError"),
      unavailable: t("clients.upsert.messages.lookupUnavailable"),
    },
  })
  useCountryToCurrency(form)

  const countryCodeValue = form.watch("countryCode")
  const clientTypeWatch = form.watch("type")
  const clientKindWatch = form.watch("kind")
  const isGovernment = clientKindWatch === "GOVERNMENT"
  const { data: requiredIdentifiersResult } = useRequiredIdentifiers(
    countryCodeValue || undefined,
    clientTypeWatch === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
  )
  // B2G routing (documents/b2g-routing/) — asked for ONLY when this client is GOVERNMENT. `null`
  // (not an error) means no B2G rule is declared for this country yet — rendered as HELP below, an
  // invoice to this client will refuse at send time (never a silent B2B send), but the client itself
  // can still be saved.
  const { data: b2gRule, isLoading: b2gRuleLoading } = useB2gRoutingRule(
    countryCodeValue || undefined,
    isGovernment,
  )

  // The country's OWN identifier requirements (every client of that country, regardless of kind)
  // PLUS whatever the B2G rule additionally requires of a GOVERNMENT client specifically (e.g. Italy's
  // Codice Univoco Ufficio) — merged into ONE list so the existing "country-specific identifiers"
  // section below (and its own sync effect / submit validation) needs no separate B2G-only code path.
  // A scheme already required by the country's own catalog is never duplicated. Stays `undefined`
  // while the country-identifiers query itself hasn't resolved yet — same "no data yet" shape the
  // rest of this form already relies on (the sync effect below short-circuits on it).
  const requiredIdentifiers = (() => {
    const base = requiredIdentifiersResult?.requirements
    if (!base) return base
    if (!isGovernment || !b2gRule?.requiredClientIdentifiers?.length) return base
    const known = new Set(base.map((r) => r.scheme))
    const extra = b2gRule.requiredClientIdentifiers
      .filter((r) => !known.has(r.scheme))
      .map((r) => ({
        scheme: r.scheme,
        label: r.label,
        appliesTo: "BOTH" as const,
        required: true,
        helpText: r.why,
      }))
    return [...base, ...extra]
  })()
  // Present only when the country has NO identifier-requirements file at all — see
  // use-required-identifiers.ts's own RequiredIdentifiersResult. Surfaced instead of a silently
  // empty section, so "this country requires nothing" and "we don't know what this country
  // requires" never look identical to the user. Never shown once the B2G rule itself already added a
  // requirement — that section renders as usual instead, the reason has nothing left to explain.
  const requiredIdentifiersReason = requiredIdentifiers?.length
    ? undefined
    : requiredIdentifiersResult?.reason

  // Sync identifier fields with what the country (+ B2G rule, for a government client) requires
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

  // The backend owns the per-country format rules; the button only needs a value.
  const canLookupScheme = (scheme: string) => canLookupCompany && lookupSchemes.includes(scheme as never)

  const onSubmit = (data: z.infer<typeof clientSchema>) => {
    if (requiredIdentifiers) {
      for (const req of requiredIdentifiers) {
        if (req.required) {
          const val = (data.identifiers || []).find((i) => i.scheme === req.scheme)?.value
          if (!val || val.trim() === "") {
            const idx = (data.identifiers || []).findIndex((i) => i.scheme === req.scheme)
            form.setError(`identifiers.${idx}.value`, { message: `${req.label} is required` })
            return
          }
        }
      }
    }

    const trigger = isEditing ? updateClient : createClient

    // Merge Peppol endpoint into identifiers (stored as PEPPOL_ENDPOINT party identifier)
    const peppolEntry =
      data.peppolSchemeId && data.peppolEndpointId?.trim()
        ? { scheme: "PEPPOL_ENDPOINT", value: `${data.peppolSchemeId}:${data.peppolEndpointId.trim()}` }
        : null
    const { peppolSchemeId: _ps, peppolEndpointId: _pe, ...dataWithoutPeppol } = data
    // Filter out empty identifiers so we don't send {scheme, value: ""}
    const payload = {
      ...dataWithoutPeppol,
      identifiers: [
        ...(data.identifiers || []).filter((i) => i.value.trim() !== ""),
        ...(peppolEntry ? [peppolEntry] : []),
      ],
    }

    trigger(payload).then((createdClient) => {
      if (!createdClient) return
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.listsAll() })
      if (!isEditing && onCreate) {
        onCreate(createdClient)
      }
      onOpenChange(false)
      form.reset()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(status) => {
        form.reset()
        onOpenChange(status)
      }}
    >
      <DialogContent
        className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden"
        dataCy="client-dialog"
      >
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
                      <CountrySelect
                        value={field.value}
                        onChange={(value) => field.onChange(value)}
                        onCountryCodeChange={(code) => form.setValue("countryCode", code)}
                        data-cy="client-country-select"
                      />
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
                      <Select
                        value={field.value || "COMPANY"}
                        onValueChange={(value) => field.onChange(value)}
                      >
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

              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("clients.upsert.fields.kind.label", "Client kind")}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value || "BUSINESS"}
                        onValueChange={(value) => field.onChange(value)}
                      >
                        <SelectTrigger dataCy="client-kind-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BUSINESS" dataCy="client-kind-business">
                            {t("clients.upsert.fields.kind.business", "Business")}
                          </SelectItem>
                          <SelectItem value="GOVERNMENT" dataCy="client-kind-government">
                            {t("clients.upsert.fields.kind.government", "Government / public body")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isGovernment ? (
                <div
                  className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm"
                  data-cy="client-b2g-hint"
                >
                  {b2gRuleLoading ? null : b2gRule ? (
                    <>
                      <p className="font-medium text-muted-foreground">
                        {t(
                          "clients.upsert.fields.b2gHint.knownTitle",
                          "This country requires a specific channel/format for public-sector invoices",
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground" data-cy="client-b2g-hint-channel">
                        {t(
                          "clients.upsert.fields.b2gHint.channel",
                          'Channel: "{{transportId}}" · Format: "{{formatSyntax}}"',
                          { transportId: b2gRule.transportId, formatSyntax: b2gRule.formatSyntax },
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{b2gRule.provenanceDescription}</p>
                      {b2gRule.requiredDocumentFields.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "clients.upsert.fields.b2gHint.documentFields",
                            "The invoice itself will also need: {{fields}}",
                            {
                              fields: b2gRule.requiredDocumentFields.map((f) => f.label).join(", "),
                            },
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground" data-cy="client-b2g-hint-no-rule">
                      {t(
                        "clients.upsert.fields.b2gHint.noRule",
                        "No B2G routing rule is declared for this country yet — sending an invoice to this client will refuse until one is added.",
                      )}
                    </p>
                  )}
                </div>
              ) : null}

              {clientType === "COMPANY" ? (
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
                          <Input
                            {...field}
                            placeholder={t("clients.upsert.fields.contactFirstname.placeholder")}
                          />
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
                          <Input
                            {...field}
                            placeholder={t("clients.upsert.fields.contactLastname.placeholder")}
                          />
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
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("clients.upsert.fields.identifiers.label") || "Country-specific identifiers"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {requiredIdentifiers.map((req) => {
                      const current = form.watch("identifiers") || []
                      const formIndex = current.findIndex((i) => i.scheme === req.scheme)
                      if (formIndex < 0) return null
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
                                  <Input
                                    {...field}
                                    placeholder={req.label}
                                    data-cy={`client-identifier-${req.scheme}`}
                                  />
                                  {canLookupScheme(req.scheme) && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      disabled={companyLookupLoading || !String(field.value || "").trim()}
                                      onClick={() => onCompanyLookup(field.value, req.scheme as LookupScheme)}
                                      title={
                                        lookupIdentifierLabel
                                          ? `${t("clients.upsert.actions.lookupCompany")} — ${lookupIdentifierLabel}`
                                          : t("clients.upsert.actions.lookupCompany")
                                      }
                                      dataCy="client-company-lookup"
                                    >
                                      {companyLookupLoading ? (
                                        <Loader2 className="animate-spin" />
                                      ) : (
                                        <Search />
                                      )}
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
              ) : requiredIdentifiersReason ? (
                <p className="text-xs text-muted-foreground" data-cy="client-identifiers-unknown-country">
                  {t(
                    "clients.upsert.fields.identifiers.unknownCountry",
                    "No identifier requirements are known for this country yet — you can save the client without one.",
                  )}
                </p>
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
                        <FormLabel>
                          {t("clients.upsert.fields.peppolSchemeId.label") || "Peppol scheme"}
                        </FormLabel>
                        <FormControl>
                          <Select value={field.value || "0088"} onValueChange={field.onChange}>
                            <SelectTrigger data-cy="client-peppol-scheme-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0088" dataCy="client-peppol-scheme-option-0088">
                                0088 — GLN
                              </SelectItem>
                              <SelectItem value="0192" dataCy="client-peppol-scheme-option-0192">
                                0192 — NO org.nr
                              </SelectItem>
                              <SelectItem value="0009" dataCy="client-peppol-scheme-option-0009">
                                0009 — FR SIRET
                              </SelectItem>
                              <SelectItem value="9925" dataCy="client-peppol-scheme-option-9925">
                                9925 — EU VAT
                              </SelectItem>
                              <SelectItem value="0007" dataCy="client-peppol-scheme-option-0007">
                                0007 — SE org.nr
                              </SelectItem>
                              <SelectItem value="0208" dataCy="client-peppol-scheme-option-0208">
                                0208 — BE org.nr
                              </SelectItem>
                              {/*
                                TODO_PRODUIT.md T4-b — was "0106 — DK CVR", WRONG: 0106 is the Dutch
                                KVK ("Vereniging van Kamers van Koophandel en Fabrieken in Nederland",
                                NL, active) in the Peppol v9.7 Participant Identifier Schemes codelist
                                (docs.peppol.eu/edelivery/codelists/), not a Danish scheme at all —
                                found by the 2026-09-02 B2G audit (TODO_ISSUES.md), re-verified live
                                against the v9.7 codelist JSON on 2026-09-03. The real Danish CVR is
                                0184 (Peppol scheme name: "The Danish Business Authority - CVR-number
                                (DK:CVR)"), added just below.
                              */}
                              <SelectItem value="0106" dataCy="client-peppol-scheme-option-0106">
                                0106 — NL KVK
                              </SelectItem>
                              <SelectItem value="0184" dataCy="client-peppol-scheme-option-0184">
                                0184 — DK CVR
                              </SelectItem>
                              <SelectItem value="0151" dataCy="client-peppol-scheme-option-0151">
                                0151 — AU ABN
                              </SelectItem>
                              <SelectItem value="0060" dataCy="client-peppol-scheme-option-0060">
                                0060 — DUNS
                              </SelectItem>
                              {/*
                                TODO_PRODUIT.md T4-a — the seven EAS the 2026-09-02 B2G audit added
                                routing rules for (backend/src/modules/documents/b2g-routing/data/
                                {ee,lt,lv,lu,cy,gr,mt}.json) but this selector never offered — each
                                label below is the scheme name the audit itself already read from the
                                Peppol v9.7 Participant Identifier Schemes codelist (that JSON's own
                                `notes` field), re-verified live against docs.peppol.eu on 2026-09-03:
                                0191 EE "Company code", 0200 LT "Legal entity code", 0218 LV "Unified
                                registration number", 0240 LU "Register of legal persons" (each
                                country has its own business-register scheme); Cyprus/Greece/Malta
                                have NO dedicated register scheme in the codelist — only their VAT
                                scheme (9928/9933/9943) exists, per those same three files' own notes.
                              */}
                              <SelectItem value="0191" dataCy="client-peppol-scheme-option-0191">
                                0191 — EE Company code
                              </SelectItem>
                              <SelectItem value="0200" dataCy="client-peppol-scheme-option-0200">
                                0200 — LT Legal entity code
                              </SelectItem>
                              <SelectItem value="0218" dataCy="client-peppol-scheme-option-0218">
                                0218 — LV Unified registration number
                              </SelectItem>
                              <SelectItem value="0240" dataCy="client-peppol-scheme-option-0240">
                                0240 — LU Register of legal persons
                              </SelectItem>
                              <SelectItem value="9928" dataCy="client-peppol-scheme-option-9928">
                                9928 — CY VAT number
                              </SelectItem>
                              <SelectItem value="9933" dataCy="client-peppol-scheme-option-9933">
                                9933 — GR VAT number
                              </SelectItem>
                              <SelectItem value="9943" dataCy="client-peppol-scheme-option-9943">
                                9943 — MT VAT number
                              </SelectItem>
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
                        <FormLabel>
                          {t("clients.upsert.fields.peppolEndpointId.label") || "Peppol endpoint ID"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={
                              t("clients.upsert.fields.peppolEndpointId.placeholder") || "e.g. 7300010000001"
                            }
                            data-cy="client-peppol-endpoint-input"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          {t("clients.upsert.fields.peppolEndpointId.helpText") ||
                            "Leave blank if this client is not on the Peppol network"}
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
                        <CurrencySelect
                          value={field.value}
                          onChange={(value) => field.onChange(value)}
                          data-cy="client-currency-select"
                        />
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  dataCy="client-cancel"
                >
                  {t("clients.upsert.actions.cancel")}
                </Button>
                <Button type="submit" loading={createLoading || updateLoading} dataCy="client-submit">
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

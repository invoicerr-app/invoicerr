import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { Loader2, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import ChannelConnectPrompt from "@/components/channel-connect-prompt"
import CountrySelect from "@/components/country-select"
import CurrencySelect from "@/components/currency-select"
import CurrencyRatesSettings from "./currency-rates.settings"
import { DatePicker } from "@/components/date-picker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useDocumentTransports } from "@/hooks/queries"
import { useCountryToCurrency } from "@/hooks/use-country-to-currency"
import { useGet, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { type LookupScheme, useCompanyLookup } from "@/hooks/use-company-lookup"
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers"
import type { Company } from "@/types"

export default function CompanySettings() {
  const { t } = useTranslation()

  const ALLOWED_DATE_FORMATS = [
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "yyyy/MM/dd",
    "dd.MM.yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "EEEE, dd MMM yyyy",
  ]

  const validateNumberFormat = (pattern: string): boolean => {
    const patternRegex = /\{(\w+)(?::(\d+))?\}/g
    const validKeys = ["year", "month", "day", "number"]
    const requiredKeys = ["number"]

    let match: RegExpExecArray | null
    const matches = []

    // biome-ignore lint/suspicious/noAssignInExpressions: canonical RegExp.exec iteration pattern
    while ((match = patternRegex.exec(pattern)) !== null) {
      matches.push(match)
    }

    for (const key of requiredKeys) {
      if (!matches.some((m) => m[1] === key)) {
        return false
      }
    }

    for (const match of matches) {
      const key = match[1]
      const padding = match[2]

      if (!validKeys.includes(key)) {
        return false
      }

      if (padding !== undefined) {
        const paddingNum = Number.parseInt(padding, 10)
        if (Number.isNaN(paddingNum) || paddingNum < 0 || paddingNum > 20) {
          return false
        }
      }
    }

    return true
  }

  const companySchema = z.object({
    name: z
      .string({
        required_error: t("settings.company.form.company.errors.required"),
      })
      .min(1, t("settings.company.form.company.errors.empty"))
      .max(100, t("settings.company.form.company.errors.maxLength")),
    description: z.string().max(500, t("settings.company.form.description.errors.maxLength")),
    foundedAt: z
      .date()
      .refine((date) => date <= new Date(), t("settings.company.form.foundedAt.errors.future")),
    currency: z
      .string({
        required_error: t("settings.company.form.currency.errors.required"),
      })
      .min(1, t("settings.company.form.currency.errors.select")),
    address: z.string().min(1, t("settings.company.form.address.errors.empty")),
    addressLine2: z.string().optional(),
    postalCode: z.string().refine((val) => {
      return /^[0-9A-Z\s-]{3,10}$/.test(val)
    }, t("settings.company.form.postalCode.errors.format")),
    city: z.string().min(1, t("settings.company.form.city.errors.empty")),
    state: z.string().optional(),
    country: z.string().min(1, t("settings.company.form.country.errors.empty")),
    countryCode: z.string().optional(),
    phone: z
      .string()
      .min(8, t("settings.company.form.phone.errors.minLength"))
      .refine((val) => {
        return /^[+]?[0-9\s\-()]{8,20}$/.test(val)
      }, t("settings.company.form.phone.errors.format")),
    email: z
      .string()
      .email()
      .min(1, t("settings.company.form.email.errors.required"))
      .refine((val) => {
        return z.string().email().safeParse(val).success
      }, t("settings.company.form.email.errors.format")),
    // BT-84 (Payment account identifier) — optional; the backend never fabricates one (see
    // Company.iban's own schema.prisma comment). Format checked loosely here (ISO 13616 shape); the
    // real checksum/format gate is the vendored XRechnung Schematron itself (BR-DE-19), never
    // duplicated here.
    iban: z
      .string()
      .optional()
      .refine((val) => {
        if (!val?.trim()) return true
        return /^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{1,30}$/.test(val.replace(/\s+/g, ""))
      }, t("settings.company.form.iban.errors.format")),
    quoteStartingNumber: z.number().min(1, t("settings.company.form.quoteStartingNumber.errors.min")),
    quoteNumberFormat: z
      .string()
      .min(1, t("settings.company.form.quoteNumberFormat.errors.required"))
      .max(100, t("settings.company.form.quoteNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.quoteNumberFormat.errors.format")),
    invoiceStartingNumber: z.number().min(1, t("settings.company.form.invoiceStartingNumber.errors.min")),
    invoiceNumberFormat: z
      .string()
      .min(1, t("settings.company.form.invoiceNumberFormat.errors.required"))
      .max(100, t("settings.company.form.invoiceNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.invoiceNumberFormat.errors.format")),
    paymentStartingNumber: z.number().min(1, t("settings.company.form.paymentStartingNumber.errors.min")),
    paymentNumberFormat: z
      .string()
      .min(1, t("settings.company.form.paymentNumberFormat.errors.required"))
      .max(100, t("settings.company.form.paymentNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.paymentNumberFormat.errors.format")),
    invoicePDFFormat: z.string().refine((val) => {
      const validFormats = ["pdf", "facturx", "zugferd", "xrechnung", "ubl", "cii"]
      return validFormats.includes(val.toLowerCase())
    }, t("settings.company.form.invoicePDFFormat.errors.format")),
    dateFormat: z
      .string()
      .min(1, t("settings.company.form.dateFormat.errors.required"))
      .max(50, t("settings.company.form.dateFormat.errors.maxLength"))
      .refine((val) => {
        return ALLOWED_DATE_FORMATS.includes(val)
      }, t("settings.company.form.dateFormat.errors.format")),
    exemptVat: z.boolean().optional(),
    identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
    // Peppol / electronic routing (stored as PEPPOL_ENDPOINT party identifier)
    peppolSchemeId: z.string().optional(),
    peppolEndpointId: z.string().optional(),
    // Which registered document transport (GET /api/documents/transports) an invoice's "send"
    // action delivers through — "" means none chosen yet, which is a valid state (sending blocks
    // until the company picks one), not something this form needs to refuse.
    invoiceTransportId: z.string().optional(),
    // Multi-currency consolidation (item 9, root TODO) — "" means no reference currency chosen,
    // which is the default and stays valid forever: every dashboard aggregate simply stays grouped
    // by currency (see backend's Company.referenceCurrency comment).
    referenceCurrency: z.string().optional(),
  })

  const { data } = useGet<Company>("/api/company/info")
  const { data: invoiceTransports } = useDocumentTransports()
  const { trigger } = useMutationWithToast(
    usePost<Company>("/api/company/info"),
    t("settings.company.messages.updateError"),
  )
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      description: "",
      exemptVat: false,
      foundedAt: new Date(),
      currency: "",
      address: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      state: "",
      country: "",
      countryCode: "",
      phone: "",
      email: "",
      iban: "",
      invoicePDFFormat: "",
      quoteStartingNumber: 1,
      quoteNumberFormat: "Q-{year}-{number}",
      invoiceStartingNumber: 1,
      invoiceNumberFormat: "INV-{year}-{number}",
      paymentStartingNumber: 1,
      paymentNumberFormat: "PAY-{year}-{number}",
      identifiers: [],
      peppolSchemeId: "0088",
      peppolEndpointId: "",
      invoiceTransportId: "",
      referenceCurrency: "",
    },
  })

  useEffect(() => {
    if (data && Object.keys(data).length > 0) {
      // Parse Peppol endpoint from partyIdentifiers (format: 'schemeId:value')
      const peppolEntry = (data.partyIdentifiers || []).find((pi) => pi.scheme === "PEPPOL_ENDPOINT")
      const peppolRaw: string = peppolEntry?.value || ""
      const colonIdx = peppolRaw.indexOf(":")
      const parsedPeppolSchemeId = colonIdx >= 0 ? peppolRaw.slice(0, colonIdx) : "0088"
      const parsedPeppolEndpointId = colonIdx >= 0 ? peppolRaw.slice(colonIdx + 1) : ""
      const nextValues = {
        ...data,
        countryCode: data.countryCode ?? undefined,
        description: data.description ?? "",
        addressLine2: data.addressLine2 ?? "",
        state: data.state ?? "",
        foundedAt: new Date(data.foundedAt),
        exemptVat: !!data.exemptVat,
        iban: data.iban ?? "",
        invoiceTransportId: data.invoiceTransportId ?? "",
        referenceCurrency: data.referenceCurrency ?? "",
        identifiers: (data.partyIdentifiers || [])
          .filter((pi) => pi.scheme !== "PEPPOL_ENDPOINT")
          .map((pi) => ({
            scheme: pi.scheme,
            value: pi.value,
          })),
        peppolSchemeId: parsedPeppolSchemeId,
        peppolEndpointId: parsedPeppolEndpointId,
      }

      // This snapshot can resolve AFTER the user has already touched the form — `/api/company/info`
      // (this effect's own trigger) and a field's OWN options (e.g. invoiceTransportId's
      // useDocumentTransports list) are two independent fetches, and nothing orders them: under load
      // the snapshot can easily lose the race to a user who opened a <Select> the instant its own
      // list became ready and picked an option. A blind `form.reset` here would then silently throw
      // away that pick and replace it with what THIS snapshot still says. Any field react-hook-form
      // already tracks as dirty is one the user acted on first, so it keeps its live value — for
      // every field this form has, not only invoiceTransportId (see e8b30e10 for the sibling bug
      // this generalizes: a spurious onValueChange("") from that same select's async list).
      const dirtyFields = form.formState.dirtyFields as Partial<Record<keyof typeof nextValues, unknown>>
      const currentValues = form.getValues() as Record<string, unknown>
      const merged: Record<string, unknown> = { ...nextValues }
      for (const key of Object.keys(dirtyFields)) {
        if (dirtyFields[key as keyof typeof nextValues]) {
          merged[key] = currentValues[key]
        }
      }

      form.reset(merged as typeof nextValues)
    }
  }, [data, form])

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
  const { data: requiredIdentifiersResult } = useRequiredIdentifiers(countryCodeValue || undefined, "COMPANY")
  const requiredIdentifiers = requiredIdentifiersResult?.requirements
  // Present only when the country has NO identifier-requirements file at all — see
  // use-required-identifiers.ts's own RequiredIdentifiersResult.
  const requiredIdentifiersReason = requiredIdentifiersResult?.reason

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

  async function onSubmit(values: z.infer<typeof companySchema>) {
    if (requiredIdentifiers) {
      for (const req of requiredIdentifiers) {
        if (req.required) {
          const val = (values.identifiers || []).find((i) => i.scheme === req.scheme)?.value
          if (!val || val.trim() === "") {
            const idx = (values.identifiers || []).findIndex((i) => i.scheme === req.scheme)
            form.setError(`identifiers.${idx}.value`, {
              message: `${req.label} is required`,
            })
            toast.error(`${req.label} is required`)
            return
          }
        }
      }
    }

    setIsLoading(true)
    // Merge Peppol endpoint into identifiers (stored as PEPPOL_ENDPOINT party identifier)
    const peppolEntry =
      values.peppolSchemeId && values.peppolEndpointId?.trim()
        ? { scheme: "PEPPOL_ENDPOINT", value: `${values.peppolSchemeId}:${values.peppolEndpointId.trim()}` }
        : null
    const { peppolSchemeId: _ps, peppolEndpointId: _pe, ...valuesWithoutPeppol } = values
    const payload = {
      ...valuesWithoutPeppol,
      identifiers: [
        ...(values.identifiers || []).filter((i) => i.value.trim() !== ""),
        ...(peppolEntry ? [peppolEntry] : []),
      ],
      // "" means "no reference currency chosen" in the form; stored as null, not an empty string.
      referenceCurrency: values.referenceCurrency?.trim() ? values.referenceCurrency : null,
      // Same "empty means unset, stored as null" convention as referenceCurrency above — an IBAN is
      // never fabricated (see Company.iban's own schema.prisma comment), so leaving this blank must
      // stay indistinguishable from "never set one".
      iban: values.iban?.trim() ? values.iban.trim().toUpperCase().replace(/\s+/g, "") : null,
    }
    trigger(payload)
      .then((result) => {
        // The trigger resolves null on failure (error already toasted).
        if (result) {
          toast.success(t("settings.company.messages.updateSuccess"))
        }
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  const getDateFormatOption = (dateFormat: string) => {
    return `${format(new Date(), dateFormat)} - (${dateFormat})`
  }

  return (
    <div>
      <ChannelConnectPrompt className="mb-4" />

      <div className="mb-4">
        <h1 className="text-3xl font-bold">{t("settings.company.title")}</h1>
        <p className="text-muted-foreground">{t("settings.company.description")}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.basicInfo")}</CardTitle>
              <CardDescription>{t("settings.company.basicInfoDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.company.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.company.placeholder")}
                          {...field}
                          data-cy="company-name-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.company.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.company.form.description.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.description.placeholder")}
                          {...field}
                          data-cy="company-description-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.description.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="foundedAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.foundedAt.label")}</FormLabel>
                      <FormControl>
                        <DatePicker
                          className="w-full bg-opacity-100"
                          value={field.value || null}
                          onChange={field.onChange}
                          placeholder={t("settings.company.form.foundedAt.placeholder")}
                          data-cy="company-foundedat-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.foundedAt.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.country.label")}</FormLabel>
                      <FormControl>
                        <CountrySelect
                          value={field.value}
                          onChange={(value) => field.onChange(value)}
                          onCountryCodeChange={(code) => form.setValue("countryCode", code)}
                          data-cy="company-country-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.country.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.currency.label")}</FormLabel>
                      <FormControl>
                        <CurrencySelect
                          value={field.value}
                          onChange={(value) => field.onChange(value)}
                          data-cy="company-currency-select"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.currency.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {requiredIdentifiers?.length ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("settings.company.form.identifiers.label") || "Country-specific identifiers"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {requiredIdentifiers.map((req) => {
                      const current = form.watch("identifiers") || []
                      const formIndex = current.findIndex((i) => i.scheme === req.scheme)
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
                                  <Input
                                    {...field}
                                    placeholder={req.label}
                                    data-cy={
                                      isLegalId
                                        ? "company-legalid-input"
                                        : req.scheme === "VAT"
                                          ? "company-vat-input"
                                          : undefined
                                    }
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
                                      data-cy="company-lookup"
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
                <p className="text-xs text-muted-foreground" data-cy="company-identifiers-unknown-country">
                  {t(
                    "settings.company.form.identifiers.unknownCountry",
                    "No identifier requirements are known for this country yet — you can save without one.",
                  )}
                </p>
              ) : null}

              {/* Peppol / Electronic routing section (seller) */}
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30 mt-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("settings.company.form.peppol.label") || "Peppol / Electronic routing (optional)"}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="peppolSchemeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("settings.company.form.peppolSchemeId.label") || "Peppol scheme"}
                        </FormLabel>
                        <FormControl>
                          <Select value={field.value || "0088"} onValueChange={field.onChange}>
                            <SelectTrigger data-cy="company-peppol-scheme-select">
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
                        <FormLabel>
                          {t("settings.company.form.peppolEndpointId.label") || "Peppol endpoint ID"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={
                              t("settings.company.form.peppolEndpointId.placeholder") || "e.g. 7300010000001"
                            }
                            data-cy="company-peppol-endpoint-input"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          {t("settings.company.form.peppolEndpointId.helpText") ||
                            "Leave blank if your company is not registered on the Peppol network"}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.address.title")}</CardTitle>
              <CardDescription>{t("settings.company.address.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("settings.company.form.address.label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("settings.company.form.address.placeholder")}
                        {...field}
                        data-cy="company-address-input"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.address.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="addressLine2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.company.form.addressLine2.label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("settings.company.form.addressLine2.placeholder")}
                        {...field}
                        data-cy="company-address-line2-input"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.addressLine2.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.postalCode.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.postalCode.placeholder")}
                          {...field}
                          data-cy="company-postalcode-input"
                        />
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
                      <FormLabel required>{t("settings.company.form.city.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.city.placeholder")}
                          {...field}
                          data-cy="company-city-input"
                        />
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
                      <FormLabel>{t("settings.company.form.state.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.state.placeholder")}
                          {...field}
                          data-cy="company-state-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.contact.title")}</CardTitle>
              <CardDescription>{t("settings.company.contact.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.phone.label")}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder={t("settings.company.form.phone.placeholder")}
                          {...field}
                          data-cy="company-phone-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.phone.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("settings.company.form.email.label")}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t("settings.company.form.email.placeholder")}
                          {...field}
                          data-cy="company-email-input"
                        />
                      </FormControl>
                      <FormDescription>{t("settings.company.form.email.description")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="iban"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.company.form.iban.label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("settings.company.form.iban.placeholder")}
                        {...field}
                        data-cy="company-iban-input"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.iban.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.numberFormats.title")}</CardTitle>
              <CardDescription>{t("settings.company.numberFormats.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="quoteStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("settings.company.form.quoteStartingNumber.label")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t("settings.company.form.quoteStartingNumber.placeholder")}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-quote-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.quoteStartingNumber.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quoteNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("settings.company.form.quoteNumberFormat.label")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("settings.company.form.quoteNumberFormat.placeholder")}
                            {...field}
                            data-cy="company-quote-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.quoteNumberFormat.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="invoiceStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t("settings.company.form.invoiceStartingNumber.label")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t("settings.company.form.invoiceStartingNumber.placeholder")}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-invoice-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.invoiceStartingNumber.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="invoiceNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("settings.company.form.invoiceNumberFormat.label")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("settings.company.form.invoiceNumberFormat.placeholder")}
                            {...field}
                            data-cy="company-invoice-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.invoiceNumberFormat.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="paymentStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t("settings.company.form.paymentStartingNumber.label")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t("settings.company.form.paymentStartingNumber.placeholder")}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-payment-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.paymentStartingNumber.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="paymentNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("settings.company.form.paymentNumberFormat.label")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("settings.company.form.paymentNumberFormat.placeholder")}
                            {...field}
                            data-cy="company-payment-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("settings.company.form.paymentNumberFormat.description")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.other.title")}</CardTitle>
              <CardDescription>{t("settings.company.other.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="invoicePDFFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("settings.company.form.invoicePDFFormat.label")}</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="w-full" data-cy="company-pdfformat-select">
                          <SelectValue
                            placeholder={t("settings.company.form.invoicePDFFormat.placeholder")}
                          />
                        </SelectTrigger>
                        <SelectContent data-cy="company-pdfformat-options">
                          <SelectItem value="pdf" data-cy="company-pdfformat-option-pdf">
                            {t("settings.company.form.invoicePDFFormat.options.pdf")}
                          </SelectItem>
                          <SelectItem value="facturx" data-cy="company-pdfformat-option-facturx">
                            {t("settings.company.form.invoicePDFFormat.options.facturx")}
                          </SelectItem>
                          <SelectItem value="zugferd" data-cy="company-pdfformat-option-zugferd">
                            {t("settings.company.form.invoicePDFFormat.options.zugferd")}
                          </SelectItem>
                          <SelectItem value="xrechnung" data-cy="company-pdfformat-option-xrechnung">
                            {t("settings.company.form.invoicePDFFormat.options.xrechnung")}
                          </SelectItem>
                          <SelectItem value="ubl" data-cy="company-pdfformat-option-ubl">
                            {t("settings.company.form.invoicePDFFormat.options.ubl")}
                          </SelectItem>
                          <SelectItem value="cii" data-cy="company-pdfformat-option-cii">
                            {t("settings.company.form.invoicePDFFormat.options.cii")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t("settings.company.form.invoicePDFFormat.description")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceTransportId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.company.form.invoiceTransportId.label")}</FormLabel>
                    <FormControl>
                      <Select
                        // NOT `field.onChange` directly — found empirically (a real "no transport
                        // configured" 501 hit while proving item 26's own e2e coverage, never from a
                        // guess): `invoiceTransports` (useDocumentTransports) loads ASYNCHRONOUSLY,
                        // unlike every other <Select>'s options on this page (all static arrays,
                        // available on the very first render). Radix's own hidden native-`<select>`
                        // mirror ("SelectBubbleInput", kept in sync for native form semantics) fires
                        // a REAL `change` event the moment `SelectItem`s go from zero (before the
                        // fetch resolves) to populated — and since NONE matched the already-loaded
                        // `field.value` while the list was still empty, that native mirror's own
                        // value is "", which bubbles up as a SPURIOUS `onValueChange("")` call,
                        // silently wiping a value this form never touched. A real user selection
                        // NEVER produces "" here (there is no "none" `SelectItem`), so simply
                        // ignoring an empty callback drops only that spurious event, never a genuine
                        // choice.
                        onValueChange={(value) => {
                          if (value) field.onChange(value)
                        }}
                        value={field.value || ""}
                      >
                        <SelectTrigger className="w-full" data-cy="company-invoice-transport-select">
                          <SelectValue
                            placeholder={t("settings.company.form.invoiceTransportId.placeholder")}
                          />
                        </SelectTrigger>
                        <SelectContent data-cy="company-invoice-transport-options">
                          {(invoiceTransports ?? []).map((transport) => (
                            <SelectItem
                              key={transport.id}
                              value={transport.id}
                              data-cy={`company-invoice-transport-option-${transport.id}`}
                            >
                              {transport.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t("settings.company.form.invoiceTransportId.description")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("settings.company.form.dateFormat.label")}</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="w-full" data-cy="company-dateformat-select">
                          <SelectValue placeholder={t("settings.company.form.dateFormat.placeholder")} />
                        </SelectTrigger>
                        <SelectContent data-cy="company-dateformat-options">
                          {ALLOWED_DATE_FORMATS.map((format) => (
                            <SelectItem
                              key={format}
                              value={format}
                              data-cy={`company-dateformat-option-${format.replace(/\//g, "-")}`}
                            >
                              {getDateFormatOption(format)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>{t("settings.company.form.dateFormat.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="exemptVat"
                render={({ field }) => (
                  <FormItem className="flex flex-col space-y-3">
                    <FormLabel>{t("settings.company.form.exemptVat.label")}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={(val) => field.onChange(val)}
                        data-cy="company-exemptvat-switch"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.exemptVat.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.company.currency.title", "Multi-currency")}</CardTitle>
              <CardDescription>
                {t(
                  "settings.company.currency.description",
                  "Choose a reference currency to see a consolidated total alongside your per-currency dashboard figures. Leave empty to keep every aggregate grouped by currency, unchanged.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="referenceCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings.company.form.referenceCurrency.label", "Reference currency")}
                    </FormLabel>
                    <FormControl>
                      <CurrencySelect
                        value={field.value}
                        onChange={(value) => field.onChange(value)}
                        data-cy="company-reference-currency-select"
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        "settings.company.form.referenceCurrency.description",
                        "Requires an exchange rate (below) for every OTHER currency you actually use before a consolidated total appears.",
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading} className="min-w-32" data-cy="company-submit-btn">
              {isLoading ? t("settings.company.form.saving") : t("settings.company.form.saveSettings")}
            </Button>
          </div>
        </form>

        <div className="mt-6">
          <CurrencyRatesSettings />
        </div>
      </Form>
    </div>
  )
}

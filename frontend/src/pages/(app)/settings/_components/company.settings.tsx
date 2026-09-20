import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { Loader2, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import ChannelConnectPrompt from "@/components/channel-connect-prompt"
import CountryReadinessAlert from "@/components/country-readiness-alert"
import CountrySelect from "@/components/country-select"
import CurrencySelect from "@/components/currency-select"
import DocumentLanguageSelect from "@/components/document-language-select"
import { fromMinor, toMinor } from "@/components/documents/totals-calculator"
import CurrencyRatesSettings from "./currency-rates.settings"
import DataExportSettings from "./data-export.settings"
import { DatePicker } from "@/components/date-picker"
import { fromCalendarDate, toCalendarDateInstant } from "@/lib/calendar-date"
import { Button } from "@/components/ui/button"
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
import {
  SettingsFieldGroup,
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
  SettingsStickyFooter,
  useSavedFlash,
} from "./settings-section"
import {
  useDocumentTransports,
  useReconciliationSettings,
  useSetReconciliationSettings,
} from "@/hooks/queries"
import { useCountryToCurrency } from "@/hooks/use-country-to-currency"
import { useGet, usePost, usePut } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { type LookupScheme, useCompanyLookup } from "@/hooks/use-company-lookup"
import { useRequiredIdentifiers, withVatIdentifier } from "@/hooks/use-required-identifiers"
import type { Company } from "@/types"

/**
 * This product's own shipped defaults when a company has never set an entry in
 * `Company.numberFormats` — backend's `documents/numbering/format-number.ts#defaultNumberFormatFor`,
 * spelled out verbatim (never expressible with a literal "{type}" token here: that substitution
 * happens server-side, once, before storage). Shown as the field's value the first time this card
 * loads for a company with nothing configured yet, exactly like `atcud.settings.tsx`'s own
 * `SHIPPED_DEFAULT_INVOICE_FORMAT` does for the same reason.
 */
const SHIPPED_DEFAULT_QUOTE_FORMAT = "QUOTE-{year}-{number:4}"
const SHIPPED_DEFAULT_INVOICE_FORMAT = "INVOICE-{year}-{number:4}"
/** Mirrors the backend's `reconciliation-settings.ts#DEFAULT_TOLERANCE_PERCENT` — shown the first
 *  time this card loads, before `useReconciliationSettings()` itself resolves (see this file's own
 *  `reconciliationSettings` sync effect). */
const SHIPPED_DEFAULT_RECONCILIATION_TOLERANCE_PERCENT = 2
/** The "not declared yet" choice in the distance-sales-regime selector. Radix's `SelectItem` refuses
 *  an empty-string value outright, but "" IS the stored state this option stands for (the column is
 *  nullable and clearing it is legitimate), so the option carries this sentinel and the field maps it
 *  back to "" — never sent to the backend, which only ever sees "ORIGIN", "DESTINATION" or null. */
const UNDECLARED_DISTANCE_SALES_REGIME = "__undeclared__"

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
    // The document-language FALLBACK for a client with no `Client.language` of its own (see
    // DocumentLanguageSelect's own header). `null`/unset falls all the way back to English.
    language: z.string().nullable().optional(),
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
    // These two back `Company.numberFormats.quote`/`.invoice`, not a dedicated column — saved through
    // `PUT /api/company/number-format` (see this file's own `onSubmit`), never through this form's
    // main `POST /api/company/info` submission. There is no third "payment" field any more: no
    // `DocumentTypeDescriptor` by that id exists (only `quote`/`invoice` declare `numbering` at all —
    // see backend's descriptors/types.ts), so a "payment number format" control would have nothing to
    // apply to.
    quoteNumberFormat: z
      .string()
      .min(1, t("settings.company.form.quoteNumberFormat.errors.required"))
      .max(100, t("settings.company.form.quoteNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.quoteNumberFormat.errors.format")),
    invoiceNumberFormat: z
      .string()
      .min(1, t("settings.company.form.invoiceNumberFormat.errors.required"))
      .max(100, t("settings.company.form.invoiceNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.invoiceNumberFormat.errors.format")),
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
    // Where this company's intra-Community distance sales to consumers are taxed. "" means "not
    // declared", which is a valid state to be in and to return to — it is not a default the product
    // picks: it blocks a cross-border B2C sale of goods inside the EU, by name, at send time (see the
    // backend's Company.distanceSalesRegime comment). Same "empty stays empty, the backend decides
    // what that blocks" shape as invoiceTransportId below.
    distanceSalesRegime: z.string().optional(),
    identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
    // Peppol / electronic routing (stored as PEPPOL_ENDPOINT party identifier)
    peppolSchemeId: z.string().optional(),
    peppolEndpointId: z.string().optional(),
    // Which registered document transport (GET /api/documents/transports) an invoice's "send"
    // action delivers through — "" means none chosen yet, which is a valid state (sending blocks
    // until the company picks one), not something this form needs to refuse.
    invoiceTransportId: z.string().optional(),
    // Multi-currency consolidation — "" means no reference currency chosen,
    // which is the default and stays valid forever: every dashboard aggregate simply stays grouped
    // by currency (see backend's Company.referenceCurrency comment).
    referenceCurrency: z.string().optional(),
    // Approval threshold — MAJOR units, in the company's own `currency` (see backend's
    // Company.approvalThresholdMinor comment). A FORM-ONLY field: converted to/from
    // `approvalThresholdMinor` at the load/submit boundary below, the same way peppolSchemeId/
    // peppolEndpointId are synthesized from/folded back into `identifiers`. `undefined` (never "")
    // means "no threshold" — a plain number input has no empty-string state of its own to reuse.
    approvalThreshold: z.number().min(0, t("settings.company.form.approvalThreshold.errors.min")).optional(),
    // Gates the daily reminder sweep (backend's
    // reminders/reminder-sweep-runner.ts). Off by default; see Company.remindersEnabled's own
    // schema.prisma comment.
    remindersEnabled: z.boolean().optional(),
    // The 3-way-match (rapprochement à 3 voies) TOLERANCE,
    // a percentage (default 2, see the backend's `reconciliation-settings.ts`). Backed by its OWN
    // endpoint (`GET`/`PUT /api/documents/received-invoices/reconciliation-settings`), saved
    // separately below — NOT part of `Company.numberFormats`/a `Company` column at all, see that
    // backend file's own header for why (a concurrent, unrelated schema change was mid-flight when
    // this feature landed). Always a concrete number once the query resolves (the backend itself
    // never returns "unset" — it resolves to the default server-side), unlike `approvalThreshold`
    // above, which genuinely has an "unset" state.
    reconciliationTolerancePercent: z
      .number()
      .min(0, t("settings.company.form.reconciliationTolerancePercent.errors.min")),
  })

  const { data } = useGet<Company>("/api/company/info")
  const { data: invoiceTransports } = useDocumentTransports()
  // The 3-way-match tolerance is a SEPARATE endpoint/query, not part of `/api/company/info`
  // (see this field's own zod comment above).
  const { data: reconciliationSettings } = useReconciliationSettings()
  const setReconciliationSettings = useSetReconciliationSettings()
  const { trigger } = useMutationWithToast(
    usePost<Company>("/api/company/info"),
    t("settings.company.messages.updateError"),
  )
  // `Company.numberFormats` is written through its own endpoint, never through `POST /api/company/info`
  // — see this file's own `onSubmit` and backend's `company.service.ts#editCompanyInfo` comment for why.
  const { trigger: saveNumberFormat } = useMutationWithToast(
    usePut<Record<string, string>>("/api/company/number-format"),
    t("settings.company.numberFormats.messages.saveError", "Failed to save the number format"),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [saved, flashSaved] = useSavedFlash()

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      description: "",
      exemptVat: false,
      distanceSalesRegime: "",
      foundedAt: new Date(),
      currency: "",
      address: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      state: "",
      country: "",
      countryCode: "",
      language: null,
      phone: "",
      email: "",
      iban: "",
      invoicePDFFormat: "",
      quoteNumberFormat: SHIPPED_DEFAULT_QUOTE_FORMAT,
      invoiceNumberFormat: SHIPPED_DEFAULT_INVOICE_FORMAT,
      identifiers: [],
      peppolSchemeId: "0088",
      peppolEndpointId: "",
      invoiceTransportId: "",
      referenceCurrency: "",
      approvalThreshold: undefined,
      remindersEnabled: false,
      reconciliationTolerancePercent: SHIPPED_DEFAULT_RECONCILIATION_TOLERANCE_PERCENT,
    },
  })

  // A SEPARATE data source from `/api/company/info` above (see this field's own zod comment) — its
  // own small sync effect, the same "don't clobber a value the user already touched" guard the main
  // effect below holds, scaled down to one field.
  useEffect(() => {
    if (reconciliationSettings === undefined) return
    if (form.formState.dirtyFields.reconciliationTolerancePercent) return
    form.setValue("reconciliationTolerancePercent", reconciliationSettings.tolerancePercent)
  }, [reconciliationSettings, form])

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
        language: data.language ?? null,
        description: data.description ?? "",
        addressLine2: data.addressLine2 ?? "",
        state: data.state ?? "",
        // The founding day as STORED, read off the value's own leading day rather than reconstructed
        // from the instant in whatever timezone this browser happens to be in — see
        // `lib/calendar-date.ts`. A row written before that rule existed carries an instant two hours
        // into the previous UTC day, and this now shows that day. The `??` keeps the previous
        // behaviour for a shape `fromCalendarDate` refuses outright: this field is `z.date()` and
        // non-nullable, so it needs a `Date` to hand back either way.
        foundedAt: fromCalendarDate(data.foundedAt) ?? new Date(data.foundedAt),
        exemptVat: !!data.exemptVat,
        distanceSalesRegime: data.distanceSalesRegime ?? "",
        remindersEnabled: !!data.remindersEnabled,
        iban: data.iban ?? "",
        invoiceTransportId: data.invoiceTransportId ?? "",
        referenceCurrency: data.referenceCurrency ?? "",
        // From `Company.numberFormats`, not a dedicated column — a type absent there (the common case
        // for a company that never touched this card) shows this product's own shipped default, the
        // same value `documents/numbering/format-number.ts#defaultNumberFormatFor` would resolve to.
        quoteNumberFormat: data.numberFormats?.quote ?? SHIPPED_DEFAULT_QUOTE_FORMAT,
        invoiceNumberFormat: data.numberFormats?.invoice ?? SHIPPED_DEFAULT_INVOICE_FORMAT,
        // MINOR (stored) -> MAJOR (form) — the company's OWN currency, same "rough guardrail, not
        // currency-converted" assumption the backend gate documents (approval-gate.ts).
        approvalThreshold:
          data.approvalThresholdMinor != null
            ? fromMinor(data.approvalThresholdMinor, data.currency || "EUR")
            : undefined,
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
  // Always offer a VAT field — see withVatIdentifier's own header for why this is a format
  // requirement, not a country one, and is never duplicated for a country whose catalog (FR/DE/PT
  // today) already declares its own VAT scheme.
  const requiredIdentifiers = withVatIdentifier(
    requiredIdentifiersResult?.requirements,
    t("settings.company.form.vat.label", "VAT Number"),
    t("settings.company.form.vat.description", "Your company's VAT identification number"),
  )
  // Present only when the country has NO identifier-requirements file at all — see
  // use-required-identifiers.ts's own RequiredIdentifiersResult. Still shown as a caption below the
  // block above (which, thanks to withVatIdentifier, is never actually empty any more) — it remains
  // true that this country's OWN catalog has nothing to add beyond the universal VAT field.
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
      const entry = next[i]
      if (!entry.scheme || requiredSchemes.has(entry.scheme)) continue
      // Never silently discard an identifier that actually carries a value. This effect's job is to
      // keep the FORM in sync with what the currently-selected country's catalog asks for — adding a
      // blank row for a newly-required scheme, and pruning an empty placeholder row nobody ever typed
      // into for a scheme that stopped being required. It must never go further than that: a scheme
      // required today and dropped from a catalog tomorrow (or one — like VAT for Italy/Poland before
      // withVatIdentifier existed — that was never in any catalog to begin with) would otherwise
      // vanish from this company's record the moment someone opens Settings and clicks Save, with no
      // warning and no way to notice before it's gone. Instead, keep it in the form (so the next
      // submit still sends it back unchanged) and let the "identifiers on file" section below make it
      // visible, so a user removes one on purpose rather than losing it by accident.
      if (entry.value.trim() !== "") continue
      next.splice(i, 1)
      changed = true
    }
    if (changed) {
      form.setValue("identifiers", next)
    }
  }, [requiredIdentifiers, form])

  // The backend owns the per-country format rules; the button only needs a value.
  const canLookupScheme = (scheme: string) => canLookupCompany && lookupSchemes.includes(scheme as never)

  // What the sync effect above keeps instead of deleting: a saved, non-empty identifier whose scheme
  // the currently-selected country's requirements no longer name. Surfaced here — rather than left
  // invisible in form state until the next submit re-sends it unchanged — so the user actually SEES
  // what's on file and can remove one deliberately (see the sync effect's own comment for why deleting
  // it automatically would be wrong).
  const requiredSchemesForDisplay = new Set((requiredIdentifiers ?? []).map((r) => r.scheme))
  const watchedIdentifiers = form.watch("identifiers") || []
  const orphanedIdentifiers = watchedIdentifiers
    .map((identifier, index) => ({ ...identifier, index }))
    .filter(
      (identifier) => identifier.value.trim() !== "" && !requiredSchemesForDisplay.has(identifier.scheme),
    )

  function removeIdentifierAt(index: number) {
    const current = form.getValues("identifiers") || []
    form.setValue(
      "identifiers",
      current.filter((_, i) => i !== index),
    )
  }

  // What was actually on file when this form loaded, keyed by scheme — same client-side twin of the
  // server's "an unchanged value is never re-validated" rule as client-upsert.tsx's own identical
  // map; see that file's comment for the full reasoning.
  const originalIdentifierValues = new Map((data?.partyIdentifiers || []).map((pi) => [pi.scheme, pi.value]))

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

      // A same-origin, best-effort ECHO of the server's own pattern gate — see client-upsert.tsx's
      // identical loop for the full reasoning (VAT exemption, unchanged-value grandfather clause).
      for (const req of requiredIdentifiers) {
        if (!req.pattern || req.scheme === "VAT") continue
        const val = (values.identifiers || []).find((i) => i.scheme === req.scheme)?.value
        if (!val || val.trim() === "") continue
        if (val === originalIdentifierValues.get(req.scheme)) continue

        let matches = true
        try {
          matches = new RegExp(req.pattern).test(val)
        } catch {
          matches = true
        }
        if (!matches) {
          const idx = (values.identifiers || []).findIndex((i) => i.scheme === req.scheme)
          const message = t(
            "settings.company.form.identifiers.patternMismatch",
            "{{label}} format is invalid",
            {
              label: req.label,
            },
          )
          form.setError(`identifiers.${idx}.value`, { message })
          toast.error(message)
          return
        }
      }
    }

    setIsLoading(true)
    // Merge Peppol endpoint into identifiers (stored as PEPPOL_ENDPOINT party identifier)
    const peppolEntry =
      values.peppolSchemeId && values.peppolEndpointId?.trim()
        ? { scheme: "PEPPOL_ENDPOINT", value: `${values.peppolSchemeId}:${values.peppolEndpointId.trim()}` }
        : null
    // `approvalThreshold` is form-only (MAJOR units) — never sent as-is, replaced by
    // `approvalThresholdMinor` below (MINOR units, the column the backend actually reads).
    // `quoteNumberFormat`/`invoiceNumberFormat` back `Company.numberFormats`, not a dedicated column —
    // saved below through `PUT /api/company/number-format`, never through this `POST /api/company/info`
    // body (see backend's `company.service.ts#editCompanyInfo` for why that endpoint allow-lists its
    // columns and does not accept `numberFormats` at all).
    const {
      peppolSchemeId: _ps,
      peppolEndpointId: _pe,
      approvalThreshold,
      quoteNumberFormat,
      invoiceNumberFormat,
      reconciliationTolerancePercent,
      ...valuesWithoutPeppol
    } = values
    const payload = {
      ...valuesWithoutPeppol,
      identifiers: [
        ...(values.identifiers || []).filter((i) => i.value.trim() !== ""),
        ...(peppolEntry ? [peppolEntry] : []),
      ],
      // A founding date is a CALENDAR DAY (`lib/calendar-date.ts`). Left as a `Date`, `JSON.stringify`
      // would serialize it through `toISOString()` and store the PREVIOUS day for every timezone east
      // of Greenwich — the same shift that moved a document's legal date. Sent as the UTC instant
      // naming the picked day rather than a bare day because this value lands straight in a Prisma
      // `DateTime` column (`company.service.ts#editCompanyInfo` passes it through untouched), and
      // Prisma refuses a bare calendar date there.
      foundedAt: toCalendarDateInstant(values.foundedAt),
      // "" means "no reference currency chosen" in the form; stored as null, not an empty string.
      referenceCurrency: values.referenceCurrency?.trim() ? values.referenceCurrency : null,
      // Same convention: "" is "not declared", stored as null. Clearing it is legitimate (a company
      // whose option lapsed, or that dropped back under the threshold) and puts sending a
      // cross-border B2C sale of goods back behind the backend's own named block.
      distanceSalesRegime: values.distanceSalesRegime?.trim() ? values.distanceSalesRegime : null,
      // Same "empty means unset, stored as null" convention as referenceCurrency above — an IBAN is
      // never fabricated (see Company.iban's own schema.prisma comment), so leaving this blank must
      // stay indistinguishable from "never set one".
      iban: values.iban?.trim() ? values.iban.trim().toUpperCase().replace(/\s+/g, "") : null,
      // MAJOR (form) -> MINOR (stored), in the company's own currency — see this field's own zod
      // comment above and approval-gate.ts's cross-currency caveat. `null`, not `undefined`: a
      // blanked-out input must explicitly clear the column back to "no approval required", which
      // `...rest`'s spread on the backend (company.service.ts#editCompanyInfo) would otherwise leave
      // untouched for `undefined`.
      approvalThresholdMinor:
        approvalThreshold != null ? toMinor(approvalThreshold, values.currency || "EUR") : null,
    }
    try {
      const result = await trigger(payload)
      if (!result) return // error already toasted by the wrapper

      // Sequential, deliberately not `Promise.all`: `updateNumberFormat` merges the new pattern into
      // the SAME `numberFormats` JSON blob via a read-modify-write on the backend — two concurrent
      // PUTs would each read the value before the other's write lands, and the second write would
      // silently drop the first (see backend's `CompanyService#updateNumberFormat`'s own "MERGES ...
      // read-modify-write" comment).
      const quoteSaved = await saveNumberFormat({ typeId: "quote", pattern: quoteNumberFormat })
      if (!quoteSaved) return // error already toasted by the wrapper
      const invoiceSaved = await saveNumberFormat({ typeId: "invoice", pattern: invoiceNumberFormat })
      if (!invoiceSaved) return // error already toasted by the wrapper

      // A THIRD, independent endpoint (see this field's own zod comment) — same sequential-await
      // discipline as the two number-format saves just above, its own try/catch since it goes through
      // `useApiMutation` (React Query), not the `usePost`/`usePut`+`useMutationWithToast` pair the rest
      // of this form still uses.
      try {
        await setReconciliationSettings.mutateAsync({ tolerancePercent: reconciliationTolerancePercent })
      } catch {
        toast.error(t("settings.company.form.reconciliationTolerancePercent.errors.saveFailed"))
        return
      }

      toast.success(t("settings.company.messages.updateSuccess"))
      flashSaved()
    } finally {
      setIsLoading(false)
    }
  }

  const getDateFormatOption = (dateFormat: string) => {
    return `${format(new Date(), dateFormat)} - (${dateFormat})`
  }

  return (
    <SettingsPage title={t("settings.company.title")} description={t("settings.company.description")}>
      <ChannelConnectPrompt />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
          <SettingsSection
            title={t("settings.company.basicInfo")}
            description={t("settings.company.basicInfoDescription")}
            contentClassName="grid gap-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
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

            <div className="grid gap-4 sm:grid-cols-2">
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
                    <CountryReadinessAlert countryCode={countryCodeValue} countryName={field.value} />
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
              <SettingsFieldGroup
                legend={t("settings.company.form.identifiers.label") || "Country-specific identifiers"}
              >
                <div className="grid gap-4 sm:grid-cols-2">
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
                                    aria-label={
                                      lookupIdentifierLabel
                                        ? `${t("clients.upsert.actions.lookupCompany")} — ${lookupIdentifierLabel}`
                                        : t("clients.upsert.actions.lookupCompany")
                                    }
                                    tooltip={
                                      lookupIdentifierLabel
                                        ? `${t("clients.upsert.actions.lookupCompany")} — ${lookupIdentifierLabel}`
                                        : t("clients.upsert.actions.lookupCompany")
                                    }
                                    dataCy="company-lookup"
                                  >
                                    {companyLookupLoading ? <Loader2 className="animate-spin" /> : <Search />}
                                  </Button>
                                )}
                              </div>
                            </FormControl>
                            {req.helpText && <p className="text-xs text-muted-foreground">{req.helpText}</p>}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )
                  })}
                </div>
                {requiredIdentifiersReason && (
                  // `requiredIdentifiers` is never actually empty any more (withVatIdentifier always
                  // adds a VAT field), but this reason is still worth surfacing: it says the
                  // country's OWN catalog has nothing else to add beyond that universal field, which
                  // is why only VAT (and no country-specific scheme) appears above.
                  <p className="text-xs text-muted-foreground" data-cy="company-identifiers-unknown-country">
                    {t(
                      "settings.company.form.identifiers.unknownCountry",
                      "No identifier requirements are known for this country yet — you can save without one.",
                    )}
                  </p>
                )}
              </SettingsFieldGroup>
            ) : null}

            {orphanedIdentifiers.length > 0 && (
              // Identifiers this company already has ON FILE whose scheme the currently-selected
              // country no longer asks for — see the sync effect above for why these are kept
              // instead of silently deleted. Shown explicitly, with a deliberate removal action, so
              // the user decides their fate instead of an unattended effect.
              <SettingsFieldGroup
                legend={t("settings.company.form.identifiers.onFile.label", "Other identifiers on file")}
                description={t(
                  "settings.company.form.identifiers.onFile.description",
                  "Saved on this company before, but not requested by the currently selected country. Kept as-is rather than removed automatically — remove one only if you're sure it's no longer needed.",
                )}
              >
                <SettingsList dataCy="company-identifiers-on-file">
                  {orphanedIdentifiers.map((identifier) => (
                    <SettingsListRow
                      key={identifier.scheme}
                      title={identifier.scheme}
                      meta={<span className="break-all">{identifier.value}</span>}
                      primary={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-cy={`company-identifier-remove-${identifier.scheme}`}
                          onClick={() => removeIdentifierAt(identifier.index)}
                        >
                          {t("settings.company.form.identifiers.onFile.remove", "Remove")}
                        </Button>
                      }
                    />
                  ))}
                </SettingsList>
              </SettingsFieldGroup>
            )}

            <SettingsFieldGroup
              legend={t("settings.company.form.peppol.label") || "Peppol / Electronic routing (optional)"}
            >
              <div className="grid gap-4 sm:grid-cols-2">
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
                            <SelectItem value="0088" data-cy="company-peppol-scheme-option-0088">
                              0088 — GLN
                            </SelectItem>
                            <SelectItem value="0192" data-cy="company-peppol-scheme-option-0192">
                              0192 — NO org.nr
                            </SelectItem>
                            <SelectItem value="0009" data-cy="company-peppol-scheme-option-0009">
                              0009 — FR SIRET
                            </SelectItem>
                            <SelectItem value="9925" data-cy="company-peppol-scheme-option-9925">
                              9925 — EU VAT
                            </SelectItem>
                            <SelectItem value="0007" data-cy="company-peppol-scheme-option-0007">
                              0007 — SE org.nr
                            </SelectItem>
                            <SelectItem value="0208" data-cy="company-peppol-scheme-option-0208">
                              0208 — BE org.nr
                            </SelectItem>
                            {/*
                                Same fix as clients/_components/client-
                                upsert.tsx's own identical selector (see that file's own comment for
                                the full citation): 0106 is the Dutch KVK in the Peppol v9.7
                                codelist, not Danish. The real Danish CVR is 0184, added just below.
                              */}
                            <SelectItem value="0106" data-cy="company-peppol-scheme-option-0106">
                              0106 — NL KVK
                            </SelectItem>
                            <SelectItem value="0184" data-cy="company-peppol-scheme-option-0184">
                              0184 — DK CVR
                            </SelectItem>
                            <SelectItem value="0151" data-cy="company-peppol-scheme-option-0151">
                              0151 — AU ABN
                            </SelectItem>
                            <SelectItem value="0060" data-cy="company-peppol-scheme-option-0060">
                              0060 — DUNS
                            </SelectItem>
                            {/*
                                Same seven EAS as clients/_components/client-
                                upsert.tsx's own identical selector (see that file's own comment for
                                the full citation, sourced from the 2026-09-02 B2G audit's
                                b2g-routing/data/{ee,lt,lv,lu,cy,gr,mt}.json).
                              */}
                            <SelectItem value="0191" data-cy="company-peppol-scheme-option-0191">
                              0191 — EE Company code
                            </SelectItem>
                            <SelectItem value="0200" data-cy="company-peppol-scheme-option-0200">
                              0200 — LT Legal entity code
                            </SelectItem>
                            <SelectItem value="0218" data-cy="company-peppol-scheme-option-0218">
                              0218 — LV Unified registration number
                            </SelectItem>
                            <SelectItem value="0240" data-cy="company-peppol-scheme-option-0240">
                              0240 — LU Register of legal persons
                            </SelectItem>
                            <SelectItem value="9928" data-cy="company-peppol-scheme-option-9928">
                              9928 — CY VAT number
                            </SelectItem>
                            <SelectItem value="9933" data-cy="company-peppol-scheme-option-9933">
                              9933 — GR VAT number
                            </SelectItem>
                            <SelectItem value="9943" data-cy="company-peppol-scheme-option-9943">
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
            </SettingsFieldGroup>
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.address.title")}
            description={t("settings.company.address.description")}
            contentClassName="grid gap-5"
          >
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

            <div className="grid gap-4 sm:grid-cols-3">
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
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.contact.title")}
            description={t("settings.company.contact.description")}
            contentClassName="grid gap-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.numberFormats.title")}
            description={t("settings.company.numberFormats.description")}
            contentClassName="grid gap-5"
          >
            {/*
                No "starting number" fields any more, and no third "payment" format field — see this
                file's own `SHIPPED_DEFAULT_*` comment. Neither backend field a removed pre-refonte
                engine used to read (`quoteStartingNumber`/`invoiceStartingNumber`) is honoured by any
                sequence logic today (`documents/numbering/sequence.ts` always starts a fresh
                (company, type) counter at 1 — see `bumpSequence`'s own header), so showing a control
                for either would be exactly the inert-input bug this card was rewritten to stop being.
                A company migrating from another product and wanting "start my invoice numbering at
                500" has no way to do that today — a real gap, not implemented here.
              */}
            <div className="grid gap-4 sm:grid-cols-2">
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
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.other.title")}
            description={t("settings.company.other.description")}
            contentClassName="grid gap-5 sm:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="invoicePDFFormat"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("settings.company.form.invoicePDFFormat.label")}</FormLabel>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="w-full" data-cy="company-pdfformat-select">
                        <SelectValue placeholder={t("settings.company.form.invoicePDFFormat.placeholder")} />
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
                  <FormDescription>{t("settings.company.form.invoicePDFFormat.description")}</FormDescription>
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
                      // configured" 501 hit while proving this picker's own e2e coverage, never from a
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
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.company.form.language.label")}</FormLabel>
                  <FormControl>
                    <DocumentLanguageSelect
                      value={field.value}
                      onChange={(value) => field.onChange(value)}
                      data-cy="company-language-select"
                    />
                  </FormControl>
                  <FormDescription>{t("settings.company.form.language.description")}</FormDescription>
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

            <FormField
              control={form.control}
              name="distanceSalesRegime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.company.form.distanceSalesRegime.label")}</FormLabel>
                  <FormControl>
                    {/* "" is a real, selectable state — "not declared yet" — not a placeholder: the
                        backend refuses a cross-border B2C sale of goods inside the EU until one of the
                        two regimes is chosen, and clearing it again must be possible. Radix Select
                        forbids an empty-string item value, so the "undeclared" option carries its own
                        sentinel and is mapped back to "" on the way into the form. */}
                    <Select
                      value={field.value?.trim() ? field.value : UNDECLARED_DISTANCE_SALES_REGIME}
                      onValueChange={(value) =>
                        field.onChange(value === UNDECLARED_DISTANCE_SALES_REGIME ? "" : value)
                      }
                    >
                      <SelectTrigger data-cy="company-distance-sales-regime-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value={UNDECLARED_DISTANCE_SALES_REGIME}
                          data-cy="company-distance-sales-regime-option-undeclared"
                        >
                          {t("settings.company.form.distanceSalesRegime.options.undeclared")}
                        </SelectItem>
                        <SelectItem value="ORIGIN" data-cy="company-distance-sales-regime-option-origin">
                          {t("settings.company.form.distanceSalesRegime.options.origin")}
                        </SelectItem>
                        <SelectItem
                          value="DESTINATION"
                          data-cy="company-distance-sales-regime-option-destination"
                        >
                          {t("settings.company.form.distanceSalesRegime.options.destination")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    {t("settings.company.form.distanceSalesRegime.description")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.approval.title")}
            description={t("settings.company.approval.description")}
            contentClassName="grid gap-5"
          >
            <FormField
              control={form.control}
              name="approvalThreshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.company.form.approvalThreshold.label")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={t("settings.company.form.approvalThreshold.placeholder")}
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                      }
                      data-cy="company-approval-threshold-input"
                    />
                  </FormControl>
                  <FormDescription>
                    {t("settings.company.form.approvalThreshold.description")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.reconciliation.title")}
            description={t("settings.company.reconciliation.description")}
            contentClassName="grid gap-5"
          >
            <FormField
              control={form.control}
              name="reconciliationTolerancePercent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.company.form.reconciliationTolerancePercent.label")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      {...field}
                      value={field.value ?? SHIPPED_DEFAULT_RECONCILIATION_TOLERANCE_PERCENT}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      data-cy="company-reconciliation-tolerance-input"
                    />
                  </FormControl>
                  <FormDescription>
                    {t("settings.company.form.reconciliationTolerancePercent.description")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.reminders.title")}
            description={t("settings.company.reminders.description")}
            contentClassName="grid gap-5"
          >
            <FormField
              control={form.control}
              name="remindersEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-col space-y-3">
                  <FormLabel>{t("settings.company.form.remindersEnabled.label")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={(val) => field.onChange(val)}
                      data-cy="company-reminders-enabled"
                    />
                  </FormControl>
                  <FormDescription>{t("settings.company.form.remindersEnabled.description")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection
            title={t("settings.company.currency.title", "Multi-currency")}
            description={t(
              "settings.company.currency.description",
              "Choose a reference currency to see a consolidated total alongside your per-currency dashboard figures. Leave empty to keep every aggregate grouped by currency, unchanged.",
            )}
            contentClassName="grid gap-5"
          >
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
          </SettingsSection>

          <SettingsStickyFooter saved={saved}>
            <Button type="submit" disabled={isLoading} className="min-w-32" data-cy="company-submit-btn">
              {isLoading ? t("settings.company.form.saving") : t("settings.company.form.saveSettings")}
            </Button>
          </SettingsStickyFooter>
        </form>

        <div className="mt-2">
          <CurrencyRatesSettings />
        </div>
        <div className="mt-2">
          <DataExportSettings />
        </div>
      </Form>
    </SettingsPage>
  )
}

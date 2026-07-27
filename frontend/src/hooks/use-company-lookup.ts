import type { FieldValues, UseFormReturn } from "react-hook-form"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { useApiQuery } from "@/hooks/use-api-query"
import { useState } from "react"

/**
 * Country-aware company lookup.
 *
 * The backend resolves the identifier against the country's own business register
 * (SIRENE for France, ARES for Czechia, ANAF for Romania…), then VIES for EU VAT, then
 * the keyless worldwide directories (GLEIF LEI index, Peppol Directory) for countries
 * that publish nothing. Which countries are served, how complete that coverage is, and
 * what the user is expected to type all come from
 * `/api/company-lookup/capabilities/:countryCode` — the form never hardcodes a jurisdiction.
 */

export type LookupScheme = "LEGAL_ID" | "VAT"

export interface CompanyLookupResultCompany {
  name?: string
  legalName?: string
  legalId?: string
  legalIdScheme?: string
  VAT?: string
  address?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
  countryCode?: string
  foundedAt?: string
  status?: "ACTIVE" | "INACTIVE" | "UNKNOWN"
  vatRegistered?: boolean | null
}

export interface CompanyLookupResult {
  found: boolean
  company: CompanyLookupResultCompany | null
  source?: string
  /** Contributing registries, joined — e.g. "VIES (EU VAT validation) + GLEIF". */
  sourceLabel?: string
  sources?: string[]
  error?: "UNSUPPORTED_COUNTRY" | "NOT_CONFIGURED" | "INVALID_IDENTIFIER" | "PROVIDER_ERROR"
  message?: string
}

export type LookupCoverage = "REGISTER" | "PARTIAL"

export interface ProviderCapability {
  id: string
  label: string
  /** REGISTER = the country's official register · PARTIAL = a worldwide directory. */
  coverage: LookupCoverage
  schemes: LookupScheme[]
  identifierLabel: string
  docsUrl?: string
  requiresCredentials: boolean
  credentialEnvVars?: string[]
  configured: boolean
}

export interface CountryLookupCapability {
  countryCode: string
  status: "AVAILABLE" | "NEEDS_CREDENTIALS" | "UNAVAILABLE"
  coverage: LookupCoverage
  providers: ProviderCapability[]
  schemes: LookupScheme[]
  identifierLabel?: string
  note?: string
}

/** Which registry (if any) can autofill a form for this country. */
export function useCompanyLookupCapability(countryCode: string | undefined | null) {
  const cc = (countryCode || "").trim().toUpperCase()
  return useApiQuery<CountryLookupCapability>(
    ["company-lookup-capability", cc],
    `/api/company-lookup/capabilities/${encodeURIComponent(cc)}`,
    { enabled: /^[A-Z]{2}$/.test(cc) },
  )
}

interface UseCompanyLookupMessages {
  invalid: string
  notFound: string
  success: string
  error: string
  unavailable: string
}

interface UseCompanyLookupOptions {
  /** ISO 3166-1 alpha-2 code of the country selected in the form. */
  countryCode: string | undefined | null
  messages: UseCompanyLookupMessages
}

function setIdentifier(form: UseFormReturn<FieldValues>, scheme: string, value: string) {
  const identifiers: { scheme: string; value: string }[] = form.getValues("identifiers") || []
  const idx = identifiers.findIndex((i) => i.scheme === scheme)
  if (idx >= 0) {
    form.setValue(`identifiers.${idx}.value`, value)
  }
}

export function useCompanyLookup<T extends FieldValues>(
  form: UseFormReturn<T>,
  { countryCode, messages }: UseCompanyLookupOptions,
) {
  const [isLoading, setIsLoading] = useState(false)
  const { data: capability } = useCompanyLookupCapability(countryCode)

  const isAvailable = capability?.status === "AVAILABLE"

  const lookup = async (rawValue: string | undefined, scheme?: LookupScheme) => {
    const value = (rawValue || "").trim()
    const cc = (countryCode || "").trim().toUpperCase()
    if (!value) {
      toast.error(messages.invalid)
      return
    }
    if (!isAvailable) {
      toast.error(capability?.note || messages.unavailable)
      return
    }

    setIsLoading(true)
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const params = new URLSearchParams({ country: cc, value })
      if (scheme) params.set("scheme", scheme)
      const res = await authenticatedFetch(`${backendUrl}/api/company-lookup?${params.toString()}`)
      if (!res.ok) throw new Error(`Company lookup failed with status ${res.status}`)

      const result = (await res.json()) as CompanyLookupResult
      if (!result.found || !result.company) {
        // The backend distinguishes "no such company" from "we could not ask".
        if (result.error === "INVALID_IDENTIFIER") toast.error(result.message || messages.invalid)
        else if (result.error === "PROVIDER_ERROR") toast.error(messages.error)
        else if (result.error) toast.error(result.message || messages.unavailable)
        else if (capability?.coverage === "PARTIAL" && capability.note)
          toast.error(messages.notFound, { description: capability.note })
        else toast.error(messages.notFound)
        return
      }

      const company = result.company
      const formValues = form.getValues()
      const setIfExists = (key: string, value: unknown) => {
        if (value !== undefined && key in formValues) {
          form.setValue(key as never, value as never)
        }
      }

      setIfExists("name", company.name)
      setIfExists("address", company.address)
      setIfExists("postalCode", company.postalCode)
      setIfExists("city", company.city)
      setIfExists("state", company.state)
      // `country` / `countryCode` are left alone on purpose: the user picked them, and
      // registries return the country name in their own language.
      if (company.foundedAt) setIfExists("foundedAt", new Date(company.foundedAt))

      if (company.legalId) setIdentifier(form as never, "LEGAL_ID", company.legalId)
      if (company.VAT) setIdentifier(form as never, "VAT", company.VAT)

      toast.success(result.sourceLabel ? `${messages.success} (${result.sourceLabel})` : messages.success)
    } catch (err) {
      console.error(err)
      toast.error(messages.error)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    lookup,
    isLoading,
    capability,
    /** True when this country has a configured registry provider. */
    isAvailable,
    /** Identifier schemes the country's registers accept — drives which field gets the button. */
    schemes: capability?.schemes ?? [],
    /** PARTIAL = only the worldwide directories answer here, so a miss is expected. */
    coverage: capability?.coverage,
    /** What the user is expected to type, e.g. "SIRET (14 digits)". */
    identifierLabel: capability?.identifierLabel,
  }
}

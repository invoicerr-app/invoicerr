import { useCountryScopedQuery } from "./use-country-scoped-query"

export interface CompanyLawFormField {
  key: string
  kind: "text" | "money"
  /** The country's own name for it. */
  label: string
  required: boolean
}

export interface CompanyLawLegalForm {
  code: string
  name: string
  fields: CompanyLawFormField[]
}

/** Mirrors backend/src/modules/documents/company-law/company-law.ts's CompanyLawSettings. */
export interface CompanyLawSettings {
  legalFormLabel?: string
  legalForms: CompanyLawLegalForm[]
}

export function useCompanyLawSettings(countryCode: string | undefined | null) {
  return useCountryScopedQuery<CompanyLawSettings>(
    ["company-law", countryCode],
    countryCode,
    (country) => `/api/documents/company-law?countryCode=${country}`,
  )
}

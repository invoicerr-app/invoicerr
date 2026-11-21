import { useApiQuery } from "./use-api-query"

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
  const url = countryCode ? `/api/documents/company-law?countryCode=${encodeURIComponent(countryCode)}` : null
  return useApiQuery<CompanyLawSettings>(["company-law", countryCode], url!, { enabled: !!url })
}

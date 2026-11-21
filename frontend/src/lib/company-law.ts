export interface CompanyLawMoney {
  amount: string
  currency: string
}

export type CompanyLawValue = string | CompanyLawMoney

/** The company settings form's copy of `Company.companyLaw`. */
export interface CompanyLawForm {
  legalForm: string
  /** A field the form rendered but nobody typed in is `undefined`. */
  values: Record<string, CompanyLawValue | undefined>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function toCompanyLawForm(stored: unknown): CompanyLawForm {
  if (!isRecord(stored)) return { legalForm: "", values: {} }
  const values: CompanyLawForm["values"] = {}
  if (isRecord(stored.values)) {
    for (const [key, value] of Object.entries(stored.values)) {
      if (typeof value === "string") values[key] = value
      else if (isRecord(value) && typeof value.amount === "string" && typeof value.currency === "string")
        values[key] = { amount: value.amount, currency: value.currency }
    }
  }
  return { legalForm: typeof stored.legalForm === "string" ? stored.legalForm : "", values }
}

/** What the API stores: amounts typed with a decimal comma or spaces are sent as `1000.50`. */
export function toCompanyLawPayload(
  form: CompanyLawForm | undefined,
): { legalForm: string; values: Record<string, CompanyLawValue> } | undefined {
  if (!form) return undefined
  const values: Record<string, CompanyLawValue> = {}
  for (const [key, value] of Object.entries(form.values ?? {})) {
    if (value === undefined) continue
    values[key] =
      typeof value === "string"
        ? value
        : { amount: value.amount.replace(/[\s  ]/g, "").replace(",", "."), currency: value.currency }
  }
  return { legalForm: form.legalForm, values }
}

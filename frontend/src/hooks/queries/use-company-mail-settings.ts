import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

/**
 * This company's OWN mail-server override. Mirrors
 * `backend/src/modules/company/mail-settings/company-mail-settings.types.ts` (wire shapes,
 * deliberately duplicated rather than shared — see `use-company-custom-fields.ts`'s own header for
 * why). `CompanyMailSettingsStatus` NEVER carries a secret: `GET /api/company/mail-settings` reports
 * `configured`/`kind`/`fromAddress` only — the SMTP password / Resend API key have no field to land
 * in here, by construction, not by an accidental omission in a screen that reads this type.
 */
export interface CompanyMailSettingsStatus {
  configured: boolean
  kind?: "smtp" | "resend"
  fromAddress?: string
}

export interface SetCompanyMailSmtpSettings {
  kind: "smtp"
  host: string
  port: number
  secure: boolean
  username: string
  /** Never round-tripped back by any GET — see `CompanyMailSettingsStatus` above. */
  password: string
  fromAddress: string
}

export interface SetCompanyMailResendSettings {
  kind: "resend"
  /** Never round-tripped back by any GET — see `CompanyMailSettingsStatus` above. */
  apiKey: string
  fromAddress: string
}

export type SetCompanyMailSettingsInput = SetCompanyMailSmtpSettings | SetCompanyMailResendSettings

const STATUS_KEY = ["company", "mail-settings"] as const

/** Status only, never a secret — see this file's own header. `configured: false` means sends for
 *  this company fall back to the instance's own provider (`MailService#sendForCompany`'s cascade). */
export function useCompanyMailSettings() {
  return useApiQuery<CompanyMailSettingsStatus>(STATUS_KEY, "/api/company/mail-settings")
}

/** Connects/replaces this company's own mail server (SMTP or Resend) — `PUT` always REPLACES any
 *  existing configuration wholesale, there is no partial-field update. */
export function useSetCompanyMailSettings() {
  return useApiMutation<SetCompanyMailSettingsInput, CompanyMailSettingsStatus>(
    "PUT",
    "/api/company/mail-settings",
    { invalidateKeys: [STATUS_KEY] },
  )
}

/** Clears this company's own mail server — sends made for it then fall back to the instance level
 *  (or a named refusal if that has nothing configured either). */
export function useClearCompanyMailSettings() {
  return useApiMutation<void, { deleted: boolean }>("DELETE", "/api/company/mail-settings", {
    invalidateKeys: [STATUS_KEY],
  })
}

/**
 * Sends a real test email to the CALLER's own address through this company's actual société →
 * instance → refus-nommé send cascade. The whole point of this button: on failure, the mutation's
 * `error` (an `ApiError` — see `use-api-query.ts`) carries the REAL provider failure message (bad
 * SMTP credentials, unreachable host, invalid Resend key, nothing configured at all, ...) verbatim
 * from the backend, never a generic "check your configuration" string.
 */
export function useTestCompanyMailSettings() {
  return useApiMutation<void, { message: string }>("POST", "/api/company/mail-settings/test")
}

import type { TFunction } from "i18next"

/**
 * One rejected vendor-export row's reason, sent by the backend as an i18n key plus its values (see
 * `backend/.../vendor/vendor-export-messages.ts`). The same sentences live in
 * `locales/en/translation.json` under `imports.vendor.*`.
 */
export interface VendorRowErrorWire {
  key: string
  params?: Record<string, string | number>
}

/** Renders the row's reasons in the current language, keeping their order. */
export function formatVendorRowErrors(
  t: TFunction,
  errors: readonly VendorRowErrorWire[] | undefined,
): string[] {
  return (errors ?? []).map((error) => t(error.key, error.params ?? {}))
}

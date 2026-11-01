import type { CompanyProfileAttribute } from "@/types"

/** Whether the country still needs this attribute answered; an undeclared dependency keeps it shown. */
export function isProfileAttributeAsked(
  attribute: CompanyProfileAttribute,
  values: Record<string, string | undefined>,
): boolean {
  if (!attribute.askedWhen) return true
  return Object.entries(attribute.askedWhen).every(([key, allowed]) => {
    const value = values[key]
    return !value || allowed.includes(value)
  })
}

/**
 * The values a condition is read against on screen. The server's own values were computed from the
 * STORED VAT exemption switch, so they do not follow it while the user edits; the derived value is
 * rebuilt from the live field here, and the locked row and every `askedWhen` on it move with the
 * switch without waiting for a save.
 */
export function profileValuesForDisplay(
  attributes: CompanyProfileAttribute[],
  stored: Record<string, string> | undefined,
  edited: Record<string, string | undefined> | undefined,
  exemptVat: boolean,
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = { ...stored, ...edited }
  for (const attribute of attributes) {
    if (!attribute.derived) continue
    values[attribute.key] = exemptVat ? attribute.derived.whenTrue : attribute.derived.whenFalse
  }
  return values
}

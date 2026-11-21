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
 * The values a condition is read against on screen, with the same reading the backend applies: the
 * derived value follows the live switch, and a declared answer whose own question no longer holds is
 * not carried, so it cannot satisfy a second-level condition or be sent. Dropping repeats to a fixed
 * point, which is what keeps the screen, the payload and the write agreeing on a chain.
 */
export function profileValuesForDisplay(
  attributes: CompanyProfileAttribute[],
  stored: Record<string, string> | undefined,
  edited: Record<string, string | undefined> | undefined,
  exemptVat: boolean,
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  for (const attribute of attributes) {
    if (!attribute.derived) continue
    values[attribute.key] = exemptVat ? attribute.derived.whenTrue : attribute.derived.whenFalse
  }
  const declared: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...stored, ...edited })) {
    if (!value) continue
    const attribute = attributes.find((candidate) => candidate.key === key)
    if (!attribute) continue
    // A derived attribute is read-only only while the source derives it (France's VAT regime is
    // FRANCHISE while the company is exempt, and a declared choice otherwise).
    if (attribute.derived && values[key] !== undefined) continue
    declared[key] = value
  }
  const carried = new Set(Object.keys(declared))
  let dropped = true
  while (dropped) {
    dropped = false
    const context: Record<string, string | undefined> = { ...values }
    for (const key of carried) context[key] = declared[key]
    for (const key of [...carried]) {
      const attribute = attributes.find((candidate) => candidate.key === key)
      if (attribute && isProfileAttributeAsked(attribute, context)) continue
      carried.delete(key)
      dropped = true
    }
  }
  for (const key of carried) values[key] = declared[key]
  return values
}

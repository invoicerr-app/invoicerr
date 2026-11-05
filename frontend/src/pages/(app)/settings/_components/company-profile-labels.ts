import type { CompanyProfileAttribute } from "@/types"

/** The narrow translator shape these helpers need: i18next's `t` with a raw-text fallback. */
export type ProfileTranslator = (key: string, options?: { defaultValue?: string }) => string

/**
 * A country declares its profile questions as data, so their text is plain English until the
 * country file also names an i18n key. The raw value stays the fallback, exactly like a country
 * overlay field's own `labelKey`/`helpTextKey` (`lib/descriptor-i18n.ts`).
 */
export function profileAttributeLabel(t: ProfileTranslator, attribute: CompanyProfileAttribute): string {
  return attribute.labelKey ? t(attribute.labelKey, { defaultValue: attribute.label }) : attribute.label
}

export function profileAttributeHelp(
  t: ProfileTranslator,
  attribute: CompanyProfileAttribute,
): string | undefined {
  if (!attribute.help) return undefined
  return attribute.helpTextKey ? t(attribute.helpTextKey, { defaultValue: attribute.help }) : attribute.help
}

export function profileAttributeValueLabel(
  t: ProfileTranslator,
  option: CompanyProfileAttribute["values"][number],
): string {
  return option.labelKey ? t(option.labelKey, { defaultValue: option.label }) : option.label
}

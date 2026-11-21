/** Six/eight-digit one-time codes are shown grouped (`1234-5678`) everywhere they are typed or
 *  displayed; non-digits are dropped so a pasted code works too. */
export function formatOtp(value: string): string {
  const cleaned = value.replace(/\D/g, "").slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

/** `7 Nov 2026` in the viewer's own locale: the one short date format the settings screens share. */
export function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

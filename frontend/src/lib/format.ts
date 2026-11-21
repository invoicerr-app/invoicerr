/** `7 Nov 2026` in the viewer's own locale: the one short date format the settings screens share. */
export function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Up to two initials for a person or a company: the first character of its first two words. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
  return words
    .slice(0, 2)
    .map((word) => (word.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toLocaleUpperCase())
    .join("")
}

/** A stable hue for a name's avatar tint, on twelve 30 degree steps so neighbours stay distinct. */
export function tintHueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return (hash % 12) * 30
}

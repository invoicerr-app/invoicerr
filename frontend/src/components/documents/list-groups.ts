export interface MonthGroup<T> {
  /** `YYYY-MM`, or null for rows whose date is missing or unreadable. */
  month: string | null
  items: T[]
}

/** Splits rows into runs of the same calendar month without reordering them: the list keeps the
 *  sort the reader chose, and a month that comes back later simply opens a new group. */
export function groupConsecutiveByMonth<T>(items: T[], dateOf: (item: T) => unknown): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = []
  for (const item of items) {
    const raw = dateOf(item)
    const month = typeof raw === "string" && /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : null
    const last = groups.at(-1)
    if (last && last.month === month) last.items.push(item)
    else groups.push({ month, items: [item] })
  }
  return groups
}

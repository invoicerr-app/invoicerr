import { fromCalendarDate, toCalendarDate } from "@/lib/calendar-date"

export type DueDateMode = "net" | "endOfMonth"

export interface DueDateTerm {
  days: number
  mode: DueDateMode
}

/** The due date a term gives for an issue date, both bare "YYYY-MM-DD" calendar days. Built from the
 *  `Date(year, month, day)` constructor, which rolls days and months over on the wall calendar, so no
 *  millisecond arithmetic ever crosses a DST change or a UTC day boundary. `undefined` when the issue
 *  date is not a real day. */
export function computeDueDate(issueDate: unknown, term: DueDateTerm): string | undefined {
  const issued = fromCalendarDate(issueDate)
  if (!issued) return undefined
  const due = new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + term.days)
  if (term.mode === "endOfMonth") {
    return toCalendarDate(new Date(due.getFullYear(), due.getMonth() + 1, 0))
  }
  return toCalendarDate(due)
}

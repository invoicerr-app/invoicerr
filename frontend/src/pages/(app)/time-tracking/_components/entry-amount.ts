import type { TimeEntry } from "@/types"

/** A time entry's duration in hours, unrounded: callers that display it format it themselves. */
export function entryHours(entry: TimeEntry): number {
  return entry.durationMinutes / 60
}

/** A time entry's billed amount: its duration in hours times its effective hourly rate (0 if none). */
export function entryAmount(entry: TimeEntry): number {
  return entryHours(entry) * (entry.effectiveHourlyRate ?? 0)
}

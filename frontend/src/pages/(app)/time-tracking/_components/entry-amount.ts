import type { TimeEntry } from "@/types"

/** A time entry's billed amount: its duration in hours times its effective hourly rate (0 if none). */
export function entryAmount(entry: TimeEntry): number {
  return (entry.durationMinutes / 60) * (entry.effectiveHourlyRate ?? 0)
}

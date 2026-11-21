import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import { buildProjectSchema } from "./project-upsert"
import { buildTimeEntrySchema } from "./time-entry-upsert"

const keyAsText = ((key: string) => key) as unknown as TFunction

function messageFor(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return result.error?.issues.find((issue) => issue.path[0] === "hourlyRate")?.message
}

describe("time tracking validation messages", () => {
  it("a negative project hourly rate reports a translated message", () => {
    const result = buildProjectSchema(keyAsText).safeParse({ clientId: "c", name: "n", hourlyRate: -1 })
    expect(messageFor(result)).toBe("timeTracking.projects.errors.hourlyRateMin")
  })

  it("a negative time entry hourly rate reports a translated message", () => {
    const result = buildTimeEntrySchema(keyAsText).safeParse({
      date: "2026-10-13",
      hours: 1,
      billable: true,
      hourlyRate: -1,
    })
    expect(messageFor(result)).toBe("timeTracking.entries.errors.hourlyRateMin")
  })

  it("the required project fields report translated messages", () => {
    const result = buildProjectSchema(keyAsText).safeParse({ clientId: "", name: "", hourlyRate: null })
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "timeTracking.projects.errors.clientRequired",
      "timeTracking.projects.errors.nameRequired",
    ])
  })

  it("a missing date and a zero duration report translated messages", () => {
    const result = buildTimeEntrySchema(keyAsText).safeParse({
      date: "",
      hours: 0,
      billable: true,
      hourlyRate: null,
    })
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "timeTracking.entries.errors.dateRequired",
      "timeTracking.entries.errors.durationPositive",
    ])
  })
})

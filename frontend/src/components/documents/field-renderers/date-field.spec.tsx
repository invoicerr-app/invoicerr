import { fireEvent, render, screen } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Form } from "@/components/ui/form"
import type { DocumentFieldDescriptor } from "@/components/documents/types"

import { DateField } from "./primitive-fields"

/**
 * What a `kind: 'date'` document field actually STORES for a given click, driven through the real
 * `<DatePicker>` rather than asserted on a helper.
 *
 * Every fixture here sits on a MONTH BOUNDARY, under a timezone whose local midnight falls on the
 * previous UTC day — the only place this class of defect is visible at all. Serializing the picked
 * `Date` as an instant moves the stored day BACKWARD by one there, and a day mid-month lands on a
 * day in the same month, the same quarter and the same fiscal year, which nothing downstream can
 * tell apart. Two boundaries, because the backward direction makes them behave differently:
 *
 *  - The FIRST of a month is where the shift actually crosses: 1 September 2026 becomes 31 August
 *    2026 — an invoice issued on the very day a mandate comes into force is then judged on the day
 *    before it and escapes the mandate, which is the concrete harm.
 *  - The LAST of a month is the mirror: 31 May 2026 becomes 30 May 2026, so a document that must
 *    fall ON a period's closing day no longer does.
 */

const issueDateField: DocumentFieldDescriptor = {
  key: "issueDate",
  kind: "date",
  label: "Issue date",
  required: true,
}

/** The five target countries, all east of Greenwich — local midnight is the PREVIOUS UTC day for
 *  every one of them. Plus one western zone, where the shift runs the OTHER way: that is what
 *  catches a "fix" which merely moves the conversion to a UTC-midnight anchor, correct for Paris and
 *  wrong for New York, and it is only visible when a stored day is read back. */
const TIMEZONES = [
  "Europe/Paris", // FR
  "Europe/Warsaw", // PL
  "Europe/Rome", // IT
  "Europe/Lisbon", // PT
  "Europe/Berlin", // DE
  "America/New_York",
]

/** 1 September 2026 — the day a channel mandate comes into force in this product's own catalogs, so
 *  the day an invoice may not be allowed to slip off. 31 May 2026 — a month's closing day. */
const BOUNDARY_DAYS = [
  {
    iso: "2026-09-01",
    year: "2026",
    monthIndex: "8",
    label: /September 1st, 2026/,
    shown: "September 1st, 2026",
  },
  { iso: "2026-05-31", year: "2026", monthIndex: "4", label: /May 31st, 2026/, shown: "May 31st, 2026" },
]

let originalTimezone: string | undefined

beforeEach(() => {
  originalTimezone = process.env.TZ
  // `PopoverContent` mounts through Radix's Popper, which needs a `ResizeObserver` jsdom has not —
  // same stub, same reason, as `date-picker.spec.tsx`.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  process.env.TZ = originalTimezone
})

function DocumentDateForm({ defaultValue }: { defaultValue?: string }) {
  const methods = useForm<{ issueDate?: string }>({ defaultValues: { issueDate: defaultValue } })
  return (
    <Form {...methods}>
      <DateField field={issueDateField} name="issueDate" />
      <output data-cy="stored">{JSON.stringify(methods.watch("issueDate") ?? null)}</output>
    </Form>
  )
}

describe("<DateField> — the day the user picks is the day the document stores", () => {
  for (const timezone of TIMEZONES) {
    for (const day of BOUNDARY_DAYS) {
      it(`stores ${day.iso} as itself in ${timezone}`, () => {
        process.env.TZ = timezone

        render(<DocumentDateForm />)

        fireEvent.click(screen.getByTestId("document-field-issueDate-input"))
        fireEvent.change(screen.getByRole("combobox", { name: "Choose the Year" }), {
          target: { value: day.year },
        })
        fireEvent.change(screen.getByRole("combobox", { name: "Choose the Month" }), {
          target: { value: day.monthIndex },
        })
        fireEvent.click(screen.getByRole("button", { name: day.label }))

        // The backend never rewrites this string (`descriptors/field-kinds.ts` validates its shape
        // and `documents.service.ts` persists it as received), and its consumers disagree on how to
        // read it: some take the literal ten-character prefix, others convert through `new Date(...)`.
        // Both readings are asserted, because a stored calendar day is the only shape satisfying both.
        const stored = JSON.parse(screen.getByTestId("stored").textContent ?? "null") as string | null
        expect(stored).not.toBeNull()
        expect(stored?.slice(0, 10)).toBe(day.iso)
        expect(new Date(stored as string).toISOString().slice(0, 10)).toBe(day.iso)
      })
    }
  }

  // The harm, stated as the rule that actually consumes this field: `channel-policy/mandate.ts`
  // compares the stored string's own leading day against a mandate's `mandatedFrom`. An invoice
  // issued ON the mandate's first day must satisfy it — shifted back one day it silently does not,
  // and the invoice goes out through a channel the country no longer allows.
  it("keeps an invoice issued on a mandate's first day inside that mandate", () => {
    process.env.TZ = "Europe/Paris"
    const mandatedFrom = "2026-09-01"

    render(<DocumentDateForm />)

    fireEvent.click(screen.getByTestId("document-field-issueDate-input"))
    fireEvent.change(screen.getByRole("combobox", { name: "Choose the Year" }), { target: { value: "2026" } })
    fireEvent.change(screen.getByRole("combobox", { name: "Choose the Month" }), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: /September 1st, 2026/ }))

    const stored = JSON.parse(screen.getByTestId("stored").textContent ?? "null") as string
    // `isOnOrAfter`'s own comparison, reproduced exactly: the literal "YYYY-MM-DD" prefix, compared
    // as strings, never as epoch instants.
    const issuedDay = /^\d{4}-\d{2}-\d{2}/.exec(stored)?.[0]
    expect(issuedDay).toBeDefined()
    expect((issuedDay as string) >= mandatedFrom).toBe(true)
  })
})

describe("<DateField> — the day the document stores is the day the screen shows back", () => {
  for (const timezone of TIMEZONES) {
    for (const day of BOUNDARY_DAYS) {
      it(`renders a stored "${day.iso}" as that same day in ${timezone}`, () => {
        process.env.TZ = timezone

        render(<DocumentDateForm defaultValue={day.iso} />)

        // The trigger's own label, formatted by date-fns from whatever `Date` the field handed the
        // picker. Read back through `new Date(...)` instead, a bare calendar day parses as UTC
        // midnight and reads as the day BEFORE for anyone west of Greenwich.
        expect(screen.getByTestId("document-field-issueDate-input")).toHaveTextContent(day.shown)
      })
    }
  }

  // A document saved BEFORE this field wrote calendar days carries a full timestamp whose UTC day is
  // already the shifted one — and that shifted day is what the backend has been putting in the XML,
  // the mandate check and the retention clock all along. The screen states that day rather than
  // reconstructing 1 September from the instant: showing a day the document does not legally have is
  // what made the shift invisible in the first place.
  it("reads a legacy full timestamp off its leading day, agreeing with the backend", () => {
    process.env.TZ = "Europe/Paris"

    render(<DocumentDateForm defaultValue="2026-08-31T22:00:00.000Z" />)

    expect(screen.getByTestId("document-field-issueDate-input")).toHaveTextContent("August 31st, 2026")
  })
})

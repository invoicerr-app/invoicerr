import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useForm } from "react-hook-form"

import { Form, FormControl, FormField, FormItem } from "@/components/ui/form"
import { DatePicker } from "./date-picker"

// Frozen so year-range assertions below ("current year +/- 10") don't drift with the calendar.
const TODAY = new Date(2026, 8, 17)

// `PopoverContent` positions itself through Radix's Popper primitive, which needs a `ResizeObserver`
// to mount at all -- jsdom has none. Same stub as `office-svg.spec.tsx` for the same reason (a
// Radix `Tooltip`/`Popover` there too).
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe("<DatePicker> — trigger opens the popover with or without a surrounding <Form>", () => {
  // The regression this guards: outside a `<Form>`, `PopoverTrigger asChild`'s only child used to be
  // a bare `Fragment` (swapped in for `FormControl`, whose `useFormField()` throws without form
  // context). A `Fragment` renders no DOM node, so Radix's `Slot` had nothing to attach `onClick`/
  // `ref` to and the popover could never open -- exactly the accounting export screen's two date
  // pickers, `useState` only, no `<Form>` anywhere near them.
  it("opens on click when rendered outside a <Form>", () => {
    render(<DatePicker value={null} onChange={vi.fn()} data-cy="standalone-date" />)

    expect(screen.queryByTestId("date-picker-today")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("standalone-date"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })

  // Same click, but through the exact composition real callers use (`<Form>` > `FormField` >
  // `FormItem` > `FormControl` > `DatePicker`, e.g. `time-entry-upsert.tsx`) -- proving the fix
  // didn't trade the standalone case for the in-form one.
  it("still opens on click inside a <Form>, unchanged", () => {
    function FormWrappedDatePicker() {
      const methods = useForm<{ date: Date | null }>({ defaultValues: { date: null } })
      return (
        <Form {...methods}>
          <FormField
            control={methods.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} data-cy="form-date" />
                </FormControl>
              </FormItem>
            )}
          />
        </Form>
      )
    }

    render(<FormWrappedDatePicker />)

    expect(screen.queryByTestId("date-picker-today")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("form-date"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })
})

describe("<DatePicker> — year dropdown range reaches next year, not just the current one", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reaches a date next year through the month/year dropdowns", () => {
    const onChange = vi.fn()
    render(<DatePicker value={null} onChange={onChange} data-cy="due-date" />)

    fireEvent.click(screen.getByTestId("due-date"))

    // react-day-picker's own default year range for `captionLayout="dropdown"` tops out at 31
    // December of the CURRENT year -- before the fix this option simply doesn't exist and the
    // `fireEvent.change` below is a no-op, leaving the assertions to fail against 2026.
    fireEvent.change(screen.getByRole("combobox", { name: "Choose the Year" }), {
      target: { value: "2027" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Choose the Month" }), {
      target: { value: "2" }, // March, 0-indexed
    })
    fireEvent.click(screen.getByRole("button", { name: /March 15th, 2027/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const picked: Date = onChange.mock.calls[0][0]
    expect(picked.getFullYear()).toBe(2027)
    expect(picked.getMonth()).toBe(2)
    expect(picked.getDate()).toBe(15)
  })
})

describe('<DatePicker> — "Today" hands back the same shape as clicking a day in the grid', () => {
  // 00:30 local on 1 June 2026 in Paris, which is still 31 May in UTC — the window in which this
  // button used to hand back an instant whose UTC day was YESTERDAY's, so a caller serializing it
  // recorded the previous day. The boundary matters twice over: the two days are also in different
  // months, so the value crosses every month-, quarter- and year-keyed rule at once.
  const JUST_PAST_LOCAL_MIDNIGHT = new Date(2026, 5, 1, 0, 30)

  beforeEach(() => {
    process.env.TZ = "Europe/Paris"
    vi.useFakeTimers()
    vi.setSystemTime(JUST_PAST_LOCAL_MIDNIGHT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("hands back local midnight of today, not the current instant", () => {
    const onChange = vi.fn()
    render(<DatePicker value={null} onChange={onChange} data-cy="issue-date" />)

    fireEvent.click(screen.getByTestId("issue-date"))
    fireEvent.click(screen.getByTestId("date-picker-today"))

    expect(onChange).toHaveBeenCalledTimes(1)
    const picked: Date = onChange.mock.calls[0][0]
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 5, 1])
    // A time of day is what makes a value an instant rather than a calendar day; every day in the
    // grid arrives at local midnight, and this must be indistinguishable from one of them.
    expect([picked.getHours(), picked.getMinutes(), picked.getSeconds()]).toEqual([0, 0, 0])
  })
})

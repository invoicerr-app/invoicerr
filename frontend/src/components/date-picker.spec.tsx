import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useForm } from "react-hook-form"

import { Form, FormControl, FormField, FormItem } from "@/components/ui/form"
import { DatePicker } from "./date-picker"

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

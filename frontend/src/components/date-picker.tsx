import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { Button } from "./ui/button"
import { Calendar } from "./ui/calendar"
import { CalendarIcon } from "lucide-react"
import { FormControl } from "./ui/form"
import { useState } from "react"
import { useFormContext } from "react-hook-form"
import type React from "react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { fromCalendarDate, todayCalendarDate } from "@/lib/calendar-date"
import { languageToLocale } from "@/lib/i18n"
import { useTranslation } from "react-i18next"

interface DatePickerProps {
  value: Date | null
  onChange: (date: Date | null) => void
  placeholder?: string
  className?: string
  showOutsideDays?: boolean
  "data-cy"?: string
}

const DatePicker: React.FC<DatePickerProps> = (field: DatePickerProps) => {
  const { t, i18n } = useTranslation()

  // `FormControl` reaches for react-hook-form's context to wire a field's id, description and error
  // together, which only exists inside a `<Form>`. It used to sit BETWEEN `PopoverTrigger` and the
  // `Button`, swapped for a bare `Fragment` outside a form to avoid throwing on the missing context.
  // That broke the trigger instead: `PopoverTrigger asChild` clones its single child and forwards
  // `ref`/`onClick` onto it, and Radix's own `Slot` deliberately skips the `ref` (to dodge a "Fragment
  // does not support refs" crash) and `onClick` never has anywhere to attach on a `Fragment`, which
  // renders no DOM node at all -- so outside a form the trigger was neither clickable nor
  // measurable, and the popover could never open (the accounting export screen's two date pickers,
  // no `<Form>` in sight). Wrapping `PopoverTrigger` itself instead of the `Button` sidesteps this
  // entirely: the trigger's only child is always the real, ref-forwarding `Button`, and `FormControl`
  // (also Slot-based) composes cleanly around it when a form is present -- the same nesting shadcn's
  // own docs use for a date field.
  const insideForm = useFormContext() !== null

  // Controlled so both a day click and the "Today" shortcut below can close the popover themselves
  // -- an uncontrolled Popover only ever closes on an outside click/Escape, which used to leave a
  // date picker sitting open (invisibly blocking nothing, but never producing the "pick and move on"
  // feel a calendar is expected to have) after a date was chosen.
  const [open, setOpen] = useState(false)

  // `captionLayout="dropdown"` without an explicit `startMonth`/`endMonth` makes react-day-picker
  // fall back to its own default: 100 years back, but only up to 31 Dec of THIS year (see
  // `getNavMonths` in its source) -- so the year <select> simply has no option past the current
  // year and a due date next year can't be picked from the calendar at all. An invoicing app needs
  // both directions: due dates get pushed a year or more out, and a founding/issue date can be
  // backfilled from years ago. Widen the window, and widen it again around whatever date is
  // already selected so an out-of-range value (an old `foundedAt`, say) still lands on a
  // navigable year instead of silently clamping the calendar's display.
  const currentYear = new Date().getFullYear()
  const selectedYear = field.value?.getFullYear()
  const startYear = selectedYear && selectedYear < currentYear - 10 ? selectedYear : currentYear - 10
  const endYear = selectedYear && selectedYear > currentYear + 10 ? selectedYear : currentYear + 10

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        variant={"outline"}
        className={cn(
          "w-[240px] pl-3 text-left font-normal",
          !field.value && "text-muted-foreground",
          field.className,
        )}
        data-cy={field["data-cy"]}
      >
        {field.value ? (
          format(field.value, "PPP", {
            locale: languageToLocale(i18n.language),
          })
        ) : (
          <span>{field.placeholder || "Pick a date"}</span>
        )}
        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
      </Button>
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {insideForm ? <FormControl className="w-full">{trigger}</FormControl> : trigger}
      {/* `max-h-(--radix-popover-content-available-height) overflow-y-auto` -- same pattern
          select.tsx/dropdown-menu.tsx already use for their own Radix content: on a short viewport
          (Cypress' own default 1000x660 measured it, ~39px of margin either side of the trigger) the
          calendar grid + "Today" footer button (~340px) can outgrow BOTH the room above and below a
          trigger positioned mid-page, and an uncapped popover then renders past the window's own
          edge with no way to reach what's cut off -- a `position: fixed` portal is not brought back
          by scrolling the page (nothing scrolls it), so without this cap "Today" is a real, if
          narrow, dead click for whichever field a form happens to position low enough, not just a
          Cypress artifact. Capping to Radix's own computed available height makes the CONTENT
          scroll internally instead of the popover overflowing the window. */}
      <PopoverContent
        className="w-full max-h-(--radix-popover-content-available-height) overflow-y-auto p-0 mt-2 rounded-lg outline-1"
        align="start"
      >
        <Calendar
          required
          mode="single"
          selected={field.value || undefined}
          onSelect={(date) => {
            field.onChange(date ?? null)
            setOpen(false)
          }}
          captionLayout="dropdown"
          startMonth={new Date(startYear, 0, 1)}
          endMonth={new Date(endYear, 11, 31)}
          showOutsideDays={field.showOutsideDays || true}
        />
        <div className="flex justify-center border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            data-cy="date-picker-today"
            onClick={() => {
              // Today's CALENDAR DAY, rebuilt at local midnight -- never a bare `new Date()`. Every
              // day in the grid above arrives as a `Date` at local midnight (react-day-picker's own
              // shape), which is this picker's whole contract; `new Date()` instead carries the
              // current time of day, so between UTC midnight and local midnight its UTC day is
              // YESTERDAY's -- the day a caller serializing through `toISOString()` would then
              // record. Going out through `lib/calendar-date.ts` and straight back in makes "Today"
              // indistinguishable from clicking today in the grid, which is what callers assume.
              field.onChange(fromCalendarDate(todayCalendarDate()))
              setOpen(false)
            }}
          >
            {t("component.date-picker.today")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { Button } from "./ui/button"
import { Calendar } from "./ui/calendar"
import { CalendarIcon } from "lucide-react"
import { FormControl } from "./ui/form"
import { Fragment, useState } from "react"
import { useFormContext } from "react-hook-form"
import type React from "react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
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
  // together. Outside a `<Form>` that context is null and the component throws while destructuring
  // it, taking the whole page down -- which is exactly what the accounting export screen did: it
  // picks two plain dates with `useState` and has no form at all. The wrapper is therefore only
  // applied when a form is actually present. Four of the five callers are inside one and keep the
  // accessibility wiring; the fifth renders a bare button, which is all it ever needed.
  const insideForm = useFormContext() !== null
  const Wrapper = insideForm ? FormControl : Fragment

  // Controlled so both a day click and the "Today" shortcut below can close the popover themselves
  // -- an uncontrolled Popover only ever closes on an outside click/Escape, which used to leave a
  // date picker sitting open (invisibly blocking nothing, but never producing the "pick and move on"
  // feel a calendar is expected to have) after a date was chosen.
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Wrapper {...(insideForm ? { className: "w-full" } : {})}>
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
        </Wrapper>
      </PopoverTrigger>
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
              field.onChange(new Date())
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

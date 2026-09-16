"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { type Control, type FieldValues, useForm, type UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { BetterInput } from "@/components/better-input"
import { DatePicker } from "@/components/date-picker"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { type SteppedDialogStep, SteppedDialog } from "@/components/ui/stepped-dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useCompany, useCreateTimeEntry, useUpdateTimeEntry } from "@/hooks/queries"
import { currencies } from "@/lib/constants/currencies"
import type { TimeEntry } from "@/types"

const timeEntrySchema = z.object({
  date: z.string().min(1, { message: "Date is required" }),
  // Hours, not minutes — the unit a person actually thinks in; converted at the submit boundary
  // (onSubmit below) the same way ArticleUpsert converts a typed price into minor units server-side.
  hours: z.number().gt(0, { message: "Duration must be greater than 0" }),
  description: z.string().optional(),
  billable: z.boolean(),
  hourlyRate: z.number().min(0).nullable(),
})

type TimeEntryForm = z.infer<typeof timeEntrySchema>

interface TimeEntryUpsertProps {
  projectId: string
  /** Read-only context shown on the first step — the project this entry belongs to isn't itself a
   *  form field (it's fixed by which project panel the dialog was opened from), but a user picking up
   *  a multi-step dialog still needs to see which project it's logging against. */
  projectName: string
  entry?: TimeEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Step 1 — the task: which project this is for (read-only, fixed by the caller) plus the free-text
 *  description of the work. No separate "task" field exists on `TimeEntry` (backend/prisma/
 *  schema.prisma) — `description` already carries that role, unchanged from the pre-wizard form. */
function TaskStep({ control, projectName }: { control: Control<TimeEntryForm>; projectName: string }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4" data-cy="time-entry-form">
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("timeTracking.entries.upsert.projectLabel")}
        </p>
        <p className="text-sm font-medium text-foreground">{projectName}</p>
      </div>

      <FormField
        name="description"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("timeTracking.entries.fields.description.label")}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={3} data-cy="time-entry-description-input" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/** Step 2 — when, and how long. No timer field exists on `TimeEntry` — hours are hand-entered, same
 *  as the pre-wizard form; adding a running timer would need its own backend state, out of scope
 *  here. */
function DurationStep({ control }: { control: Control<TimeEntryForm> }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-cy="time-entry-form">
      <FormField
        name="date"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("timeTracking.entries.fields.date.label")}</FormLabel>
            <FormControl>
              <DatePicker
                className="w-full"
                value={field.value ? new Date(field.value) : null}
                onChange={(date) => field.onChange(date ? date.toISOString() : "")}
                data-cy="time-entry-date-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="hours"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("timeTracking.entries.fields.hours.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={field.value ?? ""}
                // `undefined`, never `0`, on an emptied box — `0` is a controlled VALUE the input
                // would immediately redisplay as "0" (failing zod's own `gt(0)` besides), which then
                // makes the NEXT keystroke insert before that stray digit instead of replacing it (a
                // `.clear()` + `.type("2")` in the field produced "20", not "2" — caught by
                // 57-time-tracking.cy.ts). Same convention primitive-fields.tsx's own generic
                // NumberField already holds for exactly this reason.
                onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                type="number"
                step="0.25"
                min="0"
                postAdornment={t("timeTracking.units.hourShort")}
                data-cy="time-entry-hours-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/** Step 3 — whether this entry bills at all, and at what rate. No "linked article" field exists on
 *  `TimeEntry` — billing rides on the project's own hourly rate (or this entry's override), not a
 *  catalog article, so that part of the brief's illustrative step content doesn't map onto real
 *  data; adding one would be a backend change out of scope here. Billable comes first — the rate
 *  underneath it only matters once billing is on. */
function BillingStep({
  control,
  currencySymbol,
}: {
  control: Control<TimeEntryForm>
  currencySymbol?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4" data-cy="time-entry-form">
      <FormField
        name="billable"
        control={control}
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
            <FormLabel>{t("timeTracking.entries.fields.billable.label")}</FormLabel>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                data-cy="time-entry-billable-switch"
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        name="hourlyRate"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("timeTracking.entries.fields.hourlyRate.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                type="number"
                step="0.01"
                min="0"
                postAdornment={currencySymbol}
                placeholder={t("timeTracking.entries.fields.hourlyRate.placeholder")}
              />
            </FormControl>
            <FormDescription>{t("timeTracking.entries.fields.hourlyRate.helpText")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/**
 * A 3-step wizard (`components/ui/stepped-dialog.tsx`, owner decision 2026-09-16) — Task → Duration →
 * Billing, no separate recap step since the last one is already short. Create and edit share it; on
 * edit every step opens already clickable (`initialMaxReached`) since the entry's own values are
 * already valid.
 */
export function TimeEntryUpsert({ projectId, projectName, entry, open, onOpenChange }: TimeEntryUpsertProps) {
  const { t } = useTranslation()
  const isEdit = !!entry
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : undefined

  const { mutateAsync: createEntry, isPending: creating } = useCreateTimeEntry()
  const { mutateAsync: updateEntry, isPending: updating } = useUpdateTimeEntry()

  const form = useForm<TimeEntryForm>({
    resolver: zodResolver(timeEntrySchema),
    defaultValues: {
      date: new Date().toISOString(),
      hours: 1,
      description: "",
      billable: true,
      hourlyRate: null,
    },
  })

  useEffect(() => {
    if (entry) {
      form.reset({
        date: entry.date,
        hours: entry.durationMinutes / 60,
        description: entry.description ?? "",
        billable: entry.billable,
        hourlyRate: entry.hourlyRate,
      })
    } else {
      form.reset({
        date: new Date().toISOString(),
        hours: 1,
        description: "",
        billable: true,
        hourlyRate: null,
      })
    }
  }, [entry, open, form])

  const onSubmit = async (raw: TimeEntryForm) => {
    // `SteppedDialog` hands back `form.getValues()`, never a resolver-coerced value the way
    // `form.handleSubmit(onSubmit)` used to (see ArticleUpsert's own `onSubmit` for the concrete
    // 500 this exact gap caused there) — every field here already converts to its real type in its
    // own `onChange` (never a bare `{...field}` on a number input), so this schema has nothing to
    // coerce, but re-parsing is still what actually enforces `hours`/`hourlyRate`'s numeric shape at
    // the boundary rather than trusting every render path got its own conversion right.
    const data = timeEntrySchema.parse(raw)
    try {
      const durationMinutes = Math.round(data.hours * 60)
      if (isEdit && entry) {
        await updateEntry({
          id: entry.id,
          date: data.date,
          durationMinutes,
          description: data.description,
          billable: data.billable,
          hourlyRate: data.hourlyRate,
        })
        toast.success(t("timeTracking.entries.messages.updateSuccess"))
      } else {
        await createEntry({
          projectId,
          date: data.date,
          durationMinutes,
          description: data.description,
          billable: data.billable,
          hourlyRate: data.hourlyRate,
        })
        toast.success(t("timeTracking.entries.messages.addSuccess"))
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error(
        isEdit ? t("timeTracking.entries.messages.updateError") : t("timeTracking.entries.messages.addError"),
      )
    }
  }

  const steps: SteppedDialogStep[] = [
    {
      id: "task",
      label: t("timeTracking.entries.upsert.steps.task"),
      fields: ["description"],
      render: () => <TaskStep control={form.control} projectName={projectName} />,
    },
    {
      id: "duration",
      label: t("timeTracking.entries.upsert.steps.duration"),
      fields: ["date", "hours"],
      render: () => <DurationStep control={form.control} />,
    },
    {
      id: "billing",
      label: t("timeTracking.entries.upsert.steps.billing"),
      fields: ["billable", "hourlyRate"],
      render: () => <BillingStep control={form.control} currencySymbol={currencySymbol} />,
    },
  ]

  return (
    <SteppedDialog
      steps={steps}
      form={form as unknown as UseFormReturn<FieldValues>}
      onSubmit={(values) => onSubmit(values as TimeEntryForm)}
      submitLabel={isEdit ? t("timeTracking.actions.save") : t("timeTracking.actions.add")}
      open={open}
      onOpenChange={onOpenChange}
      title={t(`timeTracking.entries.upsert.title.${isEdit ? "edit" : "create"}`)}
      submitting={creating || updating}
      dataCy="time-entry-dialog"
      submitDataCy="time-entry-submit"
      initialMaxReached={isEdit ? steps.length - 1 : 0}
    />
  )
}

export default TimeEntryUpsert

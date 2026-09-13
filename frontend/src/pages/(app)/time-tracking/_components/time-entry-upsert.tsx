"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { BetterInput } from "@/components/better-input"
import { DatePicker } from "@/components/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
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
  entry?: TimeEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TimeEntryUpsert({ projectId, entry, open, onOpenChange }: TimeEntryUpsertProps) {
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

  const onSubmit = async (data: TimeEntryForm) => {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-lg" dataCy="time-entry-dialog">
        <DialogHeader>
          <DialogTitle>{t(`timeTracking.entries.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-cy="time-entry-form">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                name="date"
                control={form.control}
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
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("timeTracking.entries.fields.hours.label")}</FormLabel>
                    <FormControl>
                      <BetterInput
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        value={field.value ?? ""}
                        // `undefined`, never `0`, on an emptied box — `0` is a controlled VALUE the
                        // input would immediately redisplay as "0" (failing zod's own `gt(0)` besides),
                        // which then makes the NEXT keystroke insert before that stray digit instead of
                        // replacing it (a `.clear()` + `.type("2")` in the field produced "20", not
                        // "2" — caught by 57-time-tracking.cy.ts). Same convention primitive-fields.tsx's
                        // own generic NumberField already holds for exactly this reason.
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                        }
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

            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("timeTracking.entries.fields.description.label")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} data-cy="time-entry-description-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="hourlyRate"
              control={form.control}
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

            <FormField
              name="billable"
              control={form.control}
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                {t("timeTracking.actions.cancel")}
              </Button>
              <Button type="submit" disabled={creating || updating} dataCy="time-entry-submit">
                {isEdit ? t("timeTracking.actions.save") : t("timeTracking.actions.add")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default TimeEntryUpsert

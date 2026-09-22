"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { BetterInput } from "@/components/better-input"
import SearchSelect from "@/components/search-input"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useClientSearch, useCompany, useCreateProject, useUpdateProject } from "@/hooks/queries"
import { currencies } from "@/lib/constants/currencies"
import type { Project } from "@/types"

const projectSchema = z.object({
  clientId: z.string().min(1, { message: "Client is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  // `null` (never `undefined`) when emptied — same "explicit null clears it" convention
  // articles.service.ts's own quantity/lowStockThreshold fields hold (see ArticleUpsert).
  hourlyRate: z.number().min(0).nullable(),
})

type ProjectForm = z.infer<typeof projectSchema>

interface ProjectUpsertProps {
  project?: Project | null
  /** Pre-selects the client when creating from within an already-open client context — undefined for
   *  the plain "+ New project" entry point, which lets the user pick any client. */
  defaultClientId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectUpsert({ project, defaultClientId, open, onOpenChange }: ProjectUpsertProps) {
  const { t } = useTranslation()
  const isEdit = !!project
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : undefined

  const [clientSearch, setClientSearch] = useState("")
  const { data: clients = [] } = useClientSearch(clientSearch)

  const { mutateAsync: createProject, isPending: creating } = useCreateProject()
  const { mutateAsync: updateProject, isPending: updating } = useUpdateProject()

  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: { clientId: defaultClientId ?? "", name: "", description: "", hourlyRate: null },
  })

  useEffect(() => {
    if (project) {
      form.reset({
        clientId: project.clientId,
        name: project.name,
        description: project.description ?? "",
        hourlyRate: project.hourlyRate,
      })
    } else {
      form.reset({ clientId: defaultClientId ?? "", name: "", description: "", hourlyRate: null })
    }
  }, [project, defaultClientId, open, form])

  const onSubmit = async (data: ProjectForm) => {
    try {
      if (isEdit && project) {
        await updateProject({
          id: project.id,
          name: data.name,
          description: data.description,
          hourlyRate: data.hourlyRate,
        })
        toast.success(t("timeTracking.projects.messages.updateSuccess"))
      } else {
        await createProject({
          clientId: data.clientId,
          name: data.name,
          description: data.description,
          hourlyRate: data.hourlyRate,
        })
        toast.success(t("timeTracking.projects.messages.addSuccess"))
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error(
        isEdit
          ? t("timeTracking.projects.messages.updateError")
          : t("timeTracking.projects.messages.addError"),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-lg" dataCy="project-dialog">
        <DialogHeader>
          <DialogTitle>{t(`timeTracking.projects.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-cy="project-form">
            {!isEdit && (
              <FormField
                name="clientId"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("timeTracking.projects.fields.client.label")}</FormLabel>
                    <FormControl>
                      <SearchSelect
                        value={field.value}
                        onValueChange={(val) => field.onChange(Array.isArray(val) ? val[0] : val)}
                        onSearchChange={setClientSearch}
                        options={clients.map((c) => ({ label: c.name, value: c.id }))}
                        placeholder={t("timeTracking.projects.fields.client.placeholder")}
                        noResultsText={t("timeTracking.projects.fields.client.noResults")}
                        data-cy="project-client-select"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("timeTracking.projects.fields.name.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} data-cy="project-name-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("timeTracking.projects.fields.description.label")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
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
                  <FormLabel>{t("timeTracking.projects.fields.hourlyRate.label")}</FormLabel>
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
                      placeholder={t("timeTracking.projects.fields.hourlyRate.placeholder")}
                      data-cy="project-hourly-rate-input"
                    />
                  </FormControl>
                  <FormDescription>{t("timeTracking.projects.fields.hourlyRate.helpText")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                {t("timeTracking.actions.cancel")}
              </Button>
              <Button type="submit" disabled={creating || updating} dataCy="project-submit">
                {isEdit ? t("timeTracking.actions.save") : t("timeTracking.actions.add")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default ProjectUpsert

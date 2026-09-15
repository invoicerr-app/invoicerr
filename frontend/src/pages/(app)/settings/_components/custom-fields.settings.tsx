"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArchiveRestore, Loader2, Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { useMemo, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  type CompanyCustomFieldDefinition,
  type CompanyCustomFieldTarget,
  useArchiveCompanyCustomField,
  useCompanyCustomFieldDefinitions,
  useCreateCompanyCustomField,
  useDocumentTypesList,
  useRestoreCompanyCustomField,
  useUpdateCompanyCustomField,
} from "@/hooks/queries"

/** The RESTRICTED subset of field kinds this feature offers — mirrors the backend's
 *  `company-custom-fields/types.ts#ALLOWED_CUSTOM_FIELD_KINDS`. Kept as a literal array here (rather
 *  than fetched) since it never varies by company/plugin — see that file's own header for why it is
 *  narrower than the full core set. */
const ALLOWED_KINDS = ["text", "longText", "number", "money", "date", "boolean", "select"] as const

const optionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
})

function buildCreateSchema(t: (key: string) => string) {
  return z
    .object({
      target: z.enum(["DOCUMENT", "CLIENT"]),
      documentTypeId: z.string().optional(),
      label: z.string().min(1, t("settings.customFields.form.validation.labelRequired")),
      kind: z.enum(ALLOWED_KINDS),
      required: z.boolean(),
      options: z.array(optionSchema),
    })
    .superRefine((val, ctx) => {
      if (val.kind === "select" && val.options.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: t("settings.customFields.form.validation.optionsRequired"),
        })
      }
    })
}

type CreateFormValues = z.infer<ReturnType<typeof buildCreateSchema>>

const ALL_DOCUMENT_TYPES_VALUE = "__all__"

/** The create form — a fresh definition every submit (never pre-filled from an existing one: editing
 *  an existing definition is the separate `EditDialog` below, which only ever touches label/options/
 *  required, never `target`/`documentTypeId`/`kind` — see the backend's own `UpdateCompanyCustomFieldInput`
 *  header for why those three are frozen at creation). */
function CreateForm() {
  const { t } = useTranslation()
  const { data: documentTypes } = useDocumentTypesList()
  const { mutateAsync: create, isPending } = useCreateCompanyCustomField()

  const schema = useMemo(() => buildCreateSchema(t), [t])
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      target: "DOCUMENT",
      documentTypeId: ALL_DOCUMENT_TYPES_VALUE,
      label: "",
      kind: "text",
      required: false,
      options: [],
    },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options" })

  const target = form.watch("target")
  const kind = form.watch("kind")

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create({
        target: values.target,
        documentTypeId:
          values.target === "DOCUMENT" && values.documentTypeId !== ALL_DOCUMENT_TYPES_VALUE
            ? values.documentTypeId
            : undefined,
        label: values.label,
        kind: values.kind,
        required: values.required,
        options: values.kind === "select" ? values.options : undefined,
      })
      toast.success(t("settings.customFields.messages.created"))
      form.reset({
        target: values.target,
        documentTypeId: ALL_DOCUMENT_TYPES_VALUE,
        label: "",
        kind: "text",
        required: false,
        options: [],
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.customFields.messages.createError"))
    }
  })

  return (
    <Card data-cy="custom-field-create-card">
      <CardHeader>
        <CardTitle>{t("settings.customFields.create.title")}</CardTitle>
        <CardDescription>{t("settings.customFields.create.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={onSubmit} data-cy="custom-field-create-form">
            <FormField
              control={form.control}
              name="target"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.customFields.form.target")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-cy="custom-field-target-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DOCUMENT" data-cy="custom-field-target-option-document">
                          {t("settings.customFields.form.targetDocument")}
                        </SelectItem>
                        <SelectItem value="CLIENT" data-cy="custom-field-target-option-client">
                          {t("settings.customFields.form.targetClient")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {target === "DOCUMENT" && (
              <FormField
                control={form.control}
                name="documentTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.customFields.form.documentType")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger data-cy="custom-field-document-type-input">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value={ALL_DOCUMENT_TYPES_VALUE}
                            data-cy="custom-field-document-type-option-all"
                          >
                            {t("settings.customFields.form.documentTypeAll")}
                          </SelectItem>
                          {(documentTypes ?? []).map((type) => (
                            <SelectItem
                              key={type.id}
                              value={type.id}
                              data-cy={`custom-field-document-type-option-${type.id}`}
                            >
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.customFields.form.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} data-cy="custom-field-label-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.customFields.form.kind")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-cy="custom-field-kind-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALLOWED_KINDS.map((k) => (
                          <SelectItem key={k} value={k} data-cy={`custom-field-kind-option-${k}`}>
                            {t(`settings.customFields.kinds.${k}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {kind === "select" && (
              <div className="space-y-2" data-cy="custom-field-options-editor">
                <FormLabel>{t("settings.customFields.form.options")}</FormLabel>
                {fields.map((optionField, index) => (
                  <div key={optionField.id} className="flex items-center gap-2">
                    <Input
                      placeholder={t("settings.customFields.form.optionValuePlaceholder")}
                      data-cy={`custom-field-option-value-${index}`}
                      {...form.register(`options.${index}.value` as const)}
                    />
                    <Input
                      placeholder={t("settings.customFields.form.optionLabelPlaceholder")}
                      data-cy={`custom-field-option-label-${index}`}
                      {...form.register(`options.${index}.label` as const)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                      dataCy={`custom-field-option-remove-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ value: "", label: "" })}
                  dataCy="custom-field-option-add"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("settings.customFields.form.addOption")}
                </Button>
                {form.formState.errors.options?.message && (
                  <p className="text-sm text-destructive">{form.formState.errors.options.message}</p>
                )}
              </div>
            )}

            <FormField
              control={form.control}
              name="required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <FormLabel className="mb-0">{t("settings.customFields.form.required")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-cy="custom-field-required-input"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending} dataCy="custom-field-create-submit">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("settings.customFields.create.button")}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

const editOptionsSchema = z.array(optionSchema)

interface EditDialogProps {
  definition: CompanyCustomFieldDefinition
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Edits the mutable facts only — label/required/order/options — never `key`/`kind`/`target`/
 *  `documentTypeId`, which the backend's own `UpdateCompanyCustomFieldInput` doesn't even accept (see
 *  that type's header): a definition's identity and shape are frozen at creation so a value already
 *  on file for it never stops matching what created it. */
function EditDialog({ definition, open, onOpenChange }: EditDialogProps) {
  const { t } = useTranslation()
  const { mutateAsync: update, isPending } = useUpdateCompanyCustomField()

  const form = useForm<{ label: string; required: boolean; options: { value: string; label: string }[] }>({
    defaultValues: {
      label: definition.label,
      required: definition.required,
      options: definition.options ?? [],
    },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options" })

  const onSubmit = form.handleSubmit(async (values) => {
    if (definition.kind === "select" && editOptionsSchema.safeParse(values.options).success === false) {
      toast.error(t("settings.customFields.messages.invalidOptions"))
      return
    }
    try {
      await update({
        id: definition.id,
        label: values.label,
        required: values.required,
        options: definition.kind === "select" ? values.options : undefined,
      })
      toast.success(t("settings.customFields.messages.updated"))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.customFields.messages.updateError"))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-cy="custom-field-edit-dialog">
        <DialogHeader>
          <DialogTitle>{t("settings.customFields.edit.title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={onSubmit}>
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.customFields.form.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} data-cy="custom-field-edit-label-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {definition.kind === "select" && (
              <div className="space-y-2">
                <FormLabel>{t("settings.customFields.form.options")}</FormLabel>
                {fields.map((optionField, index) => (
                  <div key={optionField.id} className="flex items-center gap-2">
                    <Input
                      placeholder={t("settings.customFields.form.optionValuePlaceholder")}
                      {...form.register(`options.${index}.value` as const)}
                    />
                    <Input
                      placeholder={t("settings.customFields.form.optionLabelPlaceholder")}
                      {...form.register(`options.${index}.label` as const)}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ value: "", label: "" })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("settings.customFields.form.addOption")}
                </Button>
              </div>
            )}

            <FormField
              control={form.control}
              name="required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <FormLabel className="mb-0">{t("settings.customFields.form.required")}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={isPending} dataCy="custom-field-edit-submit">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("settings.customFields.edit.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

interface DefinitionRowProps {
  definition: CompanyCustomFieldDefinition
  documentTypeLabel?: string
}

function DefinitionRow({ definition, documentTypeLabel }: DefinitionRowProps) {
  const { t } = useTranslation()
  const [editOpen, setEditOpen] = useState(false)
  const { mutateAsync: archive, isPending: archiving } = useArchiveCompanyCustomField()
  const { mutateAsync: restore, isPending: restoring } = useRestoreCompanyCustomField()
  const isArchived = !!definition.archivedAt

  const handleArchive = async () => {
    try {
      await archive({ id: definition.id })
      toast.success(t("settings.customFields.messages.archived"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.customFields.messages.archiveError"))
    }
  }

  const handleRestore = async () => {
    try {
      await restore({ id: definition.id })
      toast.success(t("settings.customFields.messages.restored"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.customFields.messages.restoreError"))
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
      data-cy={`custom-field-row-${definition.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium" data-cy={`custom-field-row-label-${definition.id}`}>
            {definition.label}
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {definition.key}
          </Badge>
          <Badge variant="secondary">{t(`settings.customFields.kinds.${definition.kind}`)}</Badge>
          {definition.required && <Badge>{t("settings.customFields.list.required")}</Badge>}
          {isArchived && (
            <Badge variant="destructive" data-cy={`custom-field-row-archived-${definition.id}`}>
              {t("settings.customFields.list.archived")}
            </Badge>
          )}
        </div>
        {definition.target === "DOCUMENT" && (
          <p className="text-xs text-muted-foreground mt-1">
            {documentTypeLabel ?? t("settings.customFields.form.documentTypeAll")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!isArchived && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            dataCy={`custom-field-edit-button-${definition.id}`}
          >
            {t("settings.customFields.list.edit")}
          </Button>
        )}
        {isArchived ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={restoring}
            onClick={handleRestore}
            dataCy={`custom-field-restore-button-${definition.id}`}
          >
            <ArchiveRestore className="h-4 w-4 mr-2" />
            {t("settings.customFields.list.restore")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={archiving}
            onClick={handleArchive}
            dataCy={`custom-field-archive-button-${definition.id}`}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("settings.customFields.list.archive")}
          </Button>
        )}
      </div>

      {editOpen && <EditDialog definition={definition} open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  )
}

/**
 * Settings -> Custom Fields: list, create, edit,
 * archive/restore. The document FORM/LIST and the CLIENT form never import anything from this file —
 * they only ever consume `GET /custom-fields/resolved` (see `use-company-custom-fields.ts`), which is
 * what keeps this screen entirely optional machinery: a company that never opens it sees no change
 * anywhere else at all.
 */
export default function CustomFieldsSettings() {
  const { t } = useTranslation()
  const { data: definitions, isLoading } = useCompanyCustomFieldDefinitions()
  const { data: documentTypes } = useDocumentTypesList()

  const documentTypeLabel = (documentTypeId: string | null) =>
    documentTypeId ? documentTypes?.find((type) => type.id === documentTypeId)?.label : undefined

  const documentDefinitions = (definitions ?? []).filter((d) => d.target === "DOCUMENT")
  const clientDefinitions = (definitions ?? []).filter((d) => d.target === "CLIENT")

  return (
    <div className="space-y-6" data-cy="custom-fields-settings">
      <div>
        <h1 className="text-3xl font-bold">{t("settings.customFields.title")}</h1>
        <p className="text-muted-foreground">{t("settings.customFields.description")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card data-cy="custom-fields-list-document">
            <CardHeader>
              <CardTitle>{t("settings.customFields.list.documentTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">{t("settings.customFields.list.loading")}</p>
              ) : documentDefinitions.length === 0 ? (
                <EmptyState
                  icon={SlidersHorizontal}
                  size="sm"
                  title={t("settings.customFields.list.emptyDocument")}
                  data-cy="custom-fields-empty"
                />
              ) : (
                documentDefinitions.map((definition) => (
                  <DefinitionRow
                    key={definition.id}
                    definition={definition}
                    documentTypeLabel={documentTypeLabel(definition.documentTypeId)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card data-cy="custom-fields-list-client">
            <CardHeader>
              <CardTitle>{t("settings.customFields.list.clientTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">{t("settings.customFields.list.loading")}</p>
              ) : clientDefinitions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("settings.customFields.list.emptyClient")}</p>
              ) : (
                clientDefinitions.map((definition) => (
                  <DefinitionRow key={definition.id} definition={definition} />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <CreateForm />
      </div>
    </div>
  )
}

// Re-exported so a future consumer (e.g. a scripted test helper) can build the same target union
// without duplicating it — never used to VALIDATE anything server-side, the backend's own
// `isAllowedCustomFieldKind` is the source of truth there.
export type { CompanyCustomFieldTarget }

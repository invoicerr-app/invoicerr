/**
 * The per-document entry point for importing a document issued by a previous tool (issue #340):
 * upload the original file FIRST (the same drag/drop shape `received-invoice-upload-button.tsx`
 * already uses), then a form: the SAME `descriptor.fields` this type's ordinary create form shows,
 * rendered with the exact same `DocumentField` components, plus the few facts unique to an import
 * (the original number, and transmission evidence). Submitting calls the bespoke
 * `POST /documents/types/:typeId/import` (see `use-document-import.ts`'s own header for why this is
 * never the generic action endpoint) and lands on the new record's own page, already "Imported".
 *
 * Registered at "list-header-extra" for BOTH "invoice" and "credit-note" (custom-registrations.ts) -
 * one component, parameterized by `descriptor.id`, never two near-identical copies.
 */
import { useMemo, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { FileUp, Upload } from "lucide-react"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ApiError } from "@/hooks/use-api-query"
import { buildFileUploadForm, useUploadAttachment } from "@/hooks/queries/use-attachments"
import { useImportDocument } from "@/hooks/queries/use-document-import"

function ImportDocumentButton({ descriptor }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [formDialogOpen, setFormDialogOpen] = useState(false)
  const [originalFile, setOriginalFile] = useState<{
    fileRef: string
    fileName: string
    mime: string
  } | null>(null)

  const upload = useUploadAttachment()
  const importDocument = useImportDocument()

  const fields = useMemo(() => descriptor.fields, [descriptor.fields])
  const schema = useMemo(() => buildZodSchema(fields), [fields])
  // Untyped `useForm` - same posture `action-params-dialog.tsx` already holds for the identical
  // reason: `buildZodSchema` builds its shape from a RUNTIME field list, so react-hook-form can never
  // know the exact keys at compile time. The five import-only keys below (never part of `fields`)
  // ride along the same untyped form instance.
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      ...defaultValuesFor(fields),
      originalNumber: "",
      transmissionSdiId: "",
      transmissionKsefNumber: "",
      transmissionPaReference: "",
      transmissionAtcud: "",
    },
  })

  const resetAll = () => {
    setOriginalFile(null)
    form.reset({
      ...defaultValuesFor(fields),
      originalNumber: "",
      transmissionSdiId: "",
      transmissionKsefNumber: "",
      transmissionPaReference: "",
      transmissionAtcud: "",
    })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFile = async (file: File) => {
    try {
      const result = await upload.mutateAsync(buildFileUploadForm(file))
      setOriginalFile(result)
      setUploadDialogOpen(false)
      setFormDialogOpen(true)
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("documents.custom.importDocument.uploadError"),
      )
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!originalFile) return
    const {
      originalNumber,
      transmissionSdiId,
      transmissionKsefNumber,
      transmissionPaReference,
      transmissionAtcud,
      ...data
    } = values
    try {
      const result = await importDocument.mutateAsync({
        typeId: descriptor.id,
        data,
        originalNumber,
        transmissionEvidence: {
          sdiId: transmissionSdiId || undefined,
          ksefNumber: transmissionKsefNumber || undefined,
          paReference: transmissionPaReference || undefined,
          atcud: transmissionAtcud || undefined,
        },
        originalFile,
      })
      if (!result.transmitted) {
        toast.warning(t("documents.custom.importDocument.importedUntransmitted"))
      } else {
        toast.success(t("documents.custom.importDocument.imported"))
      }
      setFormDialogOpen(false)
      resetAll()
      navigate(`/documents/${result.typeId}/${result.id}`)
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("documents.custom.importDocument.importError"),
      )
    }
  })

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setUploadDialogOpen(true)}
        dataCy={`import-document-button-${descriptor.id}`}
      >
        <Upload className="h-4 w-4 me-0 md:me-2" />
        <span className="hidden md:inline-flex">{t("documents.custom.importDocument.button")}</span>
      </Button>

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open)
          if (!open) setDragOver(false)
        }}
      >
        <DialogContent data-cy="import-document-upload-dialog">
          <DialogHeader>
            <DialogTitle>{t("documents.custom.importDocument.uploadTitle")}</DialogTitle>
            <DialogDescription>{t("documents.custom.importDocument.uploadDescription")}</DialogDescription>
          </DialogHeader>
          <div
            className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-cy="import-document-dropzone"
          >
            <FileUp className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("documents.custom.importDocument.dropHint")}</p>
            <p className="text-xs text-muted-foreground">{t("documents.custom.importDocument.maxSize")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xml,application/pdf,application/xml,text/xml"
              className="hidden"
              data-cy="import-document-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <Button
              type="button"
              variant="secondary"
              loading={upload.isPending}
              onClick={(event) => {
                event.stopPropagation()
                fileInputRef.current?.click()
              }}
              dataCy="import-document-browse-button"
            >
              {t("documents.custom.importDocument.browse")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open)
          if (!open) resetAll()
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-cy="import-document-form-dialog"
        >
          <Form {...form}>
            <DialogHeader>
              <DialogTitle>
                {t("documents.custom.importDocument.formTitle", { label: descriptor.label })}
              </DialogTitle>
              <DialogDescription>
                {originalFile
                  ? t("documents.custom.importDocument.formDescription", { fileName: originalFile.fileName })
                  : null}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="originalNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.custom.importDocument.originalNumber")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-cy="import-document-original-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              {fields.map((field) => (
                <DocumentField
                  key={field.key}
                  field={field}
                  name={field.key}
                  documentTypeId={descriptor.id}
                />
              ))}

              <Separator />

              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("documents.custom.importDocument.transmissionTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("documents.custom.importDocument.transmissionHint")}
                </p>
              </div>

              <FormField
                control={form.control}
                name="transmissionSdiId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.custom.importDocument.transmissionSdiId")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-cy="import-document-transmission-sdi-id" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="transmissionKsefNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.custom.importDocument.transmissionKsefNumber")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-cy="import-document-transmission-ksef-number" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="transmissionPaReference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.custom.importDocument.transmissionPaReference")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-cy="import-document-transmission-pa-reference" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="transmissionAtcud"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.custom.importDocument.transmissionAtcud")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-cy="import-document-transmission-atcud" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormDialogOpen(false)}
                dataCy="import-document-cancel"
              >
                {t("documents.custom.importDocument.cancel")}
              </Button>
              <Button
                type="button"
                loading={importDocument.isPending}
                onClick={handleSubmit}
                dataCy="import-document-confirm"
              >
                {t("documents.custom.importDocument.confirm")}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}

registerDocumentCustomComponent("invoice", "list-header-extra", ImportDocumentButton)
registerDocumentCustomComponent("credit-note", "list-header-extra", ImportDocumentButton)

export { ImportDocumentButton }

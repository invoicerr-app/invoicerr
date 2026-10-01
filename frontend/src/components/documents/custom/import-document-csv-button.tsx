/**
 * The CSV bulk entry point for importing documents issued by a previous tool (issue #340) - mirrors
 * `pages/(app)/clients/_components/client-import-dialog.tsx`'s own pick -> preview -> confirm shape,
 * adapted for two differences this feature has and the client import does not: every row names an
 * ORIGINAL FILE (matched by filename against a set uploaded alongside the CSV, never inline in the
 * spreadsheet - a CSV cell cannot carry a PDF), and one failing row never blocks the others (see
 * `use-document-import.ts`/the backend's own `document-import-csv.service.ts` header for why).
 *
 * v1 scope, deliberately: at most ONE line item per row, and a credit note imported this way is
 * always FREE (no "invoiceId"/"correctedLines" column) - see the backend's own
 * `document-import-csv.types.ts` header. A multi-line or linked historical document needs the
 * per-document form (`import-document-button.tsx`) instead.
 */
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Download, FileUp, Upload } from "lucide-react"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { decodeCsvBytes, detectDelimiter, parseCsv } from "@/lib/csv-parse"
import { buildFileUploadForm, useUploadAttachment } from "@/hooks/queries/use-attachments"
import {
  type DocumentImportCsvRow,
  type ImportOriginalFileRef,
  useImportDocumentsCsvConfirm,
  useImportDocumentsCsvPreview,
} from "@/hooks/queries/use-document-import"
import { ApiError } from "@/hooks/use-api-query"

const MAX_IMPORT_FILE_BYTES = 1_000_000
const MAX_IMPORT_ROWS = 500

type Stage = "pick" | "preview" | "result"

const INVOICE_TEMPLATE =
  "originalNumber,originalFileName,clientId,issueDate,dueDate,currency,clientReference,notes," +
  "lineDescription,lineQuantity,lineUnit,lineUnitPrice,lineVatRate,lineDiscountPercent," +
  "transmissionSdiId,transmissionKsefNumber,transmissionPaReference,transmissionAtcud\n" +
  "OLD-2024-0142,invoice-142.pdf,clx0000000000000000000001,2024-03-15,2024-04-15,EUR,PO-9,Migrated from the previous tool," +
  "Consulting,2,hour,150,20,0,,,,\n"

const CREDIT_NOTE_TEMPLATE =
  "originalNumber,originalFileName,issueDate,currency,reason,notes," +
  "lineDescription,lineQuantity,lineUnit,lineUnitPrice,lineVatRate,lineDiscountPercent," +
  "transmissionSdiId,transmissionKsefNumber,transmissionPaReference,transmissionAtcud\n" +
  "OLD-AV-2024-0007,credit-142.pdf,2024-02-01,EUR,Commercial gesture,Migrated from the previous tool," +
  "Discount,1,unit,50,20,0,,,,\n"

function downloadTemplate(typeId: string) {
  const csv = typeId === "credit-note" ? CREDIT_NOTE_TEMPLATE : INVOICE_TEMPLATE
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${typeId}-import-template.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function ImportDocumentCsvButton({ descriptor }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const csvInputRef = useRef<HTMLInputElement>(null)
  const filesInputRef = useRef<HTMLInputElement>(null)
  const previewMutation = useImportDocumentsCsvPreview()
  const confirmMutation = useImportDocumentsCsvConfirm()
  const uploadMutation = useUploadAttachment()

  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>("pick")
  const [busy, setBusy] = useState(false)
  const [csvFileName, setCsvFileName] = useState("")
  const [rows, setRows] = useState<DocumentImportCsvRow[]>([])
  const [files, setFiles] = useState<Record<string, ImportOriginalFileRef>>({})
  const [rowVerdicts, setRowVerdicts] = useState<
    { rowNumber: number; status: "valid" | "rejected"; errors?: string[] }[]
  >([])
  const [result, setResult] = useState<{ imported: number; rejected: number } | null>(null)

  const reset = () => {
    setStage("pick")
    setBusy(false)
    setCsvFileName("")
    setRows([])
    setFiles({})
    setRowVerdicts([])
    setResult(null)
    if (csvInputRef.current) csvInputRef.current.value = ""
    if (filesInputRef.current) filesInputRef.current.value = ""
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

  const handleOriginalFiles = async (fileList: FileList) => {
    setBusy(true)
    const uploaded: Record<string, ImportOriginalFileRef> = { ...files }
    try {
      for (const file of Array.from(fileList)) {
        const ref = await uploadMutation.mutateAsync(buildFileUploadForm(file))
        uploaded[file.name] = ref
      }
      setFiles(uploaded)
      toast.success(t("documents.custom.importCsv.filesUploaded", { count: fileList.length }))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("documents.custom.importCsv.uploadError"))
    } finally {
      setBusy(false)
    }
  }

  const handleCsv = async (file: File) => {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      toast.error(
        t("documents.custom.importCsv.fileTooLarge", { maxKb: Math.round(MAX_IMPORT_FILE_BYTES / 1000) }),
      )
      return
    }
    setBusy(true)
    setCsvFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const text = decodeCsvBytes(buffer)
      const delimiter = detectDelimiter(text.split(/\r\n|\r|\n/)[0] ?? "")
      const { headers, rows: dataRows } = parseCsv(text, delimiter)

      if (dataRows.length === 0) {
        toast.error(t("documents.custom.importCsv.empty"))
        setBusy(false)
        return
      }
      if (dataRows.length > MAX_IMPORT_ROWS) {
        toast.error(
          t("documents.custom.importCsv.tooManyRows", { max: MAX_IMPORT_ROWS, count: dataRows.length }),
        )
        setBusy(false)
        return
      }

      const parsedRows: DocumentImportCsvRow[] = dataRows.map((cells, index) => {
        const row: Record<string, string> = { rowNumber: String(index + 2) }
        headers.forEach((header, i) => {
          row[header.trim()] = cells[i] ?? ""
        })
        return { ...row, rowNumber: index + 2 } as unknown as DocumentImportCsvRow
      })
      setRows(parsedRows)

      const response = await previewMutation.mutateAsync({ typeId: descriptor.id, rows: parsedRows, files })
      setRowVerdicts(response.rows)
      setStage("preview")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("documents.custom.importCsv.parseFailed"))
    } finally {
      setBusy(false)
    }
  }

  const willImport = rowVerdicts.filter((r) => r.status === "valid")
  const rejected = rowVerdicts.filter((r) => r.status === "rejected")

  const handleConfirm = async () => {
    setBusy(true)
    try {
      const response = await confirmMutation.mutateAsync({ typeId: descriptor.id, rows, files })
      setResult(response)
      setStage("result")
    } catch {
      toast.error(t("documents.custom.importCsv.confirmFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        dataCy={`import-document-csv-button-${descriptor.id}`}
      >
        <FileUp className="h-4 w-4 me-0 md:me-2" />
        <span className="hidden md:inline-flex">{t("documents.custom.importCsv.button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl" data-cy="import-document-csv-dialog">
          <DialogHeader>
            <DialogTitle>{t("documents.custom.importCsv.title", { label: descriptor.label })}</DialogTitle>
            <DialogDescription>{t("documents.custom.importCsv.description")}</DialogDescription>
          </DialogHeader>

          {stage === "pick" && (
            <div className="space-y-4">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() => downloadTemplate(descriptor.id)}
                dataCy="import-document-csv-template-link"
              >
                <Download className="h-4 w-4 me-1.5" />
                {t("documents.custom.importCsv.downloadTemplate")}
              </Button>

              <div className="space-y-2">
                <p className="text-sm font-medium">{t("documents.custom.importCsv.step1")}</p>
                <input
                  ref={filesInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.xml,application/pdf,application/xml,text/xml"
                  data-cy="import-document-csv-files-input"
                  onChange={(event) => {
                    if (event.target.files) void handleOriginalFiles(event.target.files)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("documents.custom.importCsv.filesHint", { count: Object.keys(files).length })}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">{t("documents.custom.importCsv.step2")}</p>
                <div
                  role="button"
                  tabIndex={0}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center"
                  onClick={() => csvInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      csvInputRef.current?.click()
                    }
                  }}
                  data-cy="import-document-csv-dropzone"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    {csvFileName || t("documents.custom.importCsv.dropHint")}
                  </p>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    data-cy="import-document-csv-file-input"
                    onChange={(event) => {
                      const selected = event.target.files?.[0]
                      if (selected) void handleCsv(selected)
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {stage === "preview" && (
            <div className="space-y-4" data-cy="import-document-csv-preview">
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge variant="secondary" data-cy="import-document-csv-summary-valid">
                  {t("documents.custom.importCsv.summary.willImport", { count: willImport.length })}
                </Badge>
                <Badge variant="destructive" data-cy="import-document-csv-summary-rejected">
                  {t("documents.custom.importCsv.summary.rejected", { count: rejected.length })}
                </Badge>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <Table data-cy="import-document-csv-preview-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">
                        {t("documents.custom.importCsv.preview.row")}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        {t("documents.custom.importCsv.preview.originalNumber")}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        {t("documents.custom.importCsv.preview.status")}
                      </TableHead>
                      <TableHead>{t("documents.custom.importCsv.preview.detail")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowVerdicts.map((verdict) => {
                      const row = rows.find((r) => r.rowNumber === verdict.rowNumber)
                      return (
                        <TableRow
                          key={verdict.rowNumber}
                          data-cy={`import-document-csv-row-${verdict.rowNumber}`}
                        >
                          <TableCell className="tabular-nums align-top">{verdict.rowNumber}</TableCell>
                          <TableCell className="align-top">{row?.originalNumber}</TableCell>
                          <TableCell className="align-top">
                            {verdict.status === "valid" ? (
                              <Badge variant="secondary">
                                {t("documents.custom.importCsv.status.valid")}
                              </Badge>
                            ) : (
                              <Badge variant="destructive">
                                {t("documents.custom.importCsv.status.rejected")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words align-top text-sm text-muted-foreground">
                            {(verdict.errors ?? []).join("; ")}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {stage === "result" && result && (
            <div className="space-y-3" data-cy="import-document-csv-result">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("documents.custom.importCsv.result.imported")}
                </span>
                <span
                  className="font-mono tabular-nums font-medium"
                  data-cy="import-document-csv-result-imported"
                >
                  {result.imported}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("documents.custom.importCsv.result.rejected")}
                </span>
                <span
                  className="font-mono tabular-nums font-medium"
                  data-cy="import-document-csv-result-rejected"
                >
                  {result.rejected}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            {stage === "preview" && (
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={willImport.length === 0 || busy || confirmMutation.isPending}
                dataCy="import-document-csv-confirm-button"
              >
                {t("documents.custom.importCsv.confirm", { count: willImport.length })}
              </Button>
            )}
            {stage === "result" && (
              <Button
                type="button"
                onClick={() => handleOpenChange(false)}
                dataCy="import-document-csv-close-button"
              >
                {t("common.finish")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

registerDocumentCustomComponent("invoice", "list-header-extra", ImportDocumentCsvButton)
registerDocumentCustomComponent("credit-note", "list-header-extra", ImportDocumentCsvButton)

export { ImportDocumentCsvButton }

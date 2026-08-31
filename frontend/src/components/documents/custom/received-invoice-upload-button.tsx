import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FileUp, Upload } from "lucide-react"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { DocumentUpsertDialog } from "@/components/documents/document-upsert-dialog"
import type { DocumentInstance } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiError } from "@/hooks/use-api-query"
import { useUploadReceivedInvoice, type UploadReceivedInvoicePreview } from "@/hooks/queries"

/** Reads a browser `File` into a base64 string — same technique
 *  settings/_components/signing-certificates.settings.tsx already uses for its own PFX upload (the
 *  one other binary-file upload in this frontend), reused verbatim rather than re-derived. */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(arrayBuffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** `extraction.fields` (received-invoices/extraction.ts) already uses the SAME keys as the
 *  descriptor's own business fields (supplier/supplierNumber/issueDate/currency/netAmount/
 *  vatAmount/grossAmount) — no translation table needed, just a plain pass-through plus the three
 *  system fields (fileRef/fileName/fileMime) the descriptor deliberately never declares as
 *  `DocumentFieldDescriptor`s (see received-invoice.descriptor.ts's own header). `dueDate` is never
 *  present here — this core's own outbound CII/UBL builders never emit it either (see
 *  extraction.ts's own header) — left for the user to type in if they know it. */
function buildInitialData(preview: UploadReceivedInvoicePreview): Record<string, unknown> {
  return {
    ...preview.extraction.fields,
    fileRef: preview.fileRef,
    fileName: preview.fileName,
    fileMime: preview.mime,
  }
}

/**
 * Root TODO item 18's own entry point into creating a received-invoice: a file (PDF, or XML CII/
 * UBL, or Factur-X) is uploaded FIRST, structurally extracted best-effort, and the result seeds a
 * normal `DocumentUpsertDialog` — the user reviews/edits exactly like any other document type's
 * create form, then the generic "receive" action persists it. Registered at "list-header-extra"
 * (custom-slots.ts) — additive, next to the generic "New" button document-list.tsx always renders.
 *
 * Two dialogs, two stages, deliberately not merged into one: the upload step has no document fields
 * to show yet (only a file picker), and the review step has no file picker to show anymore (the file
 * is already stored — see the descriptor's own header on why `fileRef` is never a re-typable field).
 */
function ReceivedInvoiceUploadButton({ descriptor }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<UploadReceivedInvoicePreview | null>(null)

  const upload = useUploadReceivedInvoice()

  const resetUploadDialog = () => {
    setDragOver(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFile = async (file: File) => {
    try {
      const base64 = await fileToBase64(file)
      const result = await upload.mutateAsync({
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        base64,
      })
      setUploadDialogOpen(false)
      resetUploadDialog()
      setPreview(result)
    } catch (error) {
      // The backend's OWN message — it names the exact duplicate (SHA-256 + existing document id)
      // when that is the refusal, never a generic "upload failed" that would hide it.
      toast.error(
        error instanceof ApiError ? error.message : t("documents.custom.receivedInvoiceUpload.error"),
      )
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const handleActionSuccess = (result: DocumentInstance) => {
    // "receive" never targets a different document type (unlike the quote's "convert-to-invoice") —
    // closing unconditionally here is what makes "confirmer → le document est received, badge
    // visible" true: the list behind this dialog already refetched (useRunDocumentAction's own
    // `invalidateKeys`), so closing just reveals it.
    if (result.status === "received") setPreview(null)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setUploadDialogOpen(true)}
        dataCy="received-invoice-upload-button"
      >
        <Upload className="h-4 w-4 mr-0 md:mr-2" />
        <span className="hidden md:inline-flex">{t("documents.custom.receivedInvoiceUpload.button")}</span>
      </Button>

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open)
          if (!open) resetUploadDialog()
        }}
      >
        <DialogContent data-cy="received-invoice-upload-dialog">
          <DialogHeader>
            <DialogTitle>{t("documents.custom.receivedInvoiceUpload.title")}</DialogTitle>
          </DialogHeader>

          {/* A drag/drop zone is inherently a plain container with drag handlers — the file input
              right below it is the real, keyboard-reachable control (clicking this zone just
              forwards to it). */}
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
            data-cy="received-invoice-upload-dropzone"
          >
            <FileUp className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("documents.custom.receivedInvoiceUpload.dropHint")}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xml,application/pdf,application/xml,text/xml"
              className="hidden"
              data-cy="received-invoice-upload-file-input"
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
              dataCy="received-invoice-upload-browse-button"
            >
              {t("documents.custom.receivedInvoiceUpload.browse")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {preview && (
        <DocumentUpsertDialog
          descriptor={descriptor}
          open
          onOpenChange={(open) => !open && setPreview(null)}
          initialData={buildInitialData(preview)}
          onActionSuccess={handleActionSuccess}
        />
      )}
    </>
  )
}

registerDocumentCustomComponent("received-invoice", "list-header-extra", ReceivedInvoiceUploadButton)

export { ReceivedInvoiceUploadButton }

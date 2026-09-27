import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FileUp, Upload } from "lucide-react"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { DocumentCreateDialog } from "@/components/documents/document-create-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/hooks/use-api-query"
import {
  buildFileUploadForm,
  useReceivedInvoiceOcrResult,
  useUploadReceivedInvoice,
  type UploadReceivedInvoicePreview,
} from "@/hooks/queries"

/** `extraction.fields` (received-invoices/extraction.ts) already uses the SAME keys as the
 *  descriptor's own business fields (supplier/supplierNumber/issueDate/currency/netAmount/
 *  vatAmount/grossAmount) — no translation table needed, just a plain pass-through plus the three
 *  system fields (fileRef/fileName/fileMime) the descriptor deliberately never declares as
 *  `DocumentFieldDescriptor`s (see received-invoice.descriptor.ts's own header). `dueDate` is never
 *  present here — this core's own outbound CII/UBL builders never emit it either (see
 *  extraction.ts's own header) — left for the user to type in if they know it.
 *
 *  An OCR-read field (`extraction.syntax === "OCR"`) lands in this SAME
 *  `preview.extraction.fields` object, keyed identically (`ocr/extractor.ts`'s own
 *  `ExtractedInvoiceProposal` is the EXACT `ExtractedInvoiceFields` shape) — this function needed NO
 *  change at all to pick it up: a PRE-FILLED, still fully editable field either way, the human
 *  reviews before confirming "receive" regardless of which reader produced it. */
function buildInitialData(preview: UploadReceivedInvoicePreview): Record<string, unknown> {
  return {
    ...preview.extraction.fields,
    fileRef: preview.fileRef,
    fileName: preview.fileName,
    fileMime: preview.mime,
  }
}

/**
 * ONE honest message per outcome — shared between the synchronous path (`handleFile` below, called
 * the instant the upload responds) and the async OCR path (the poll-completion effect further down,
 * called once the background job's own `status` turns `"done"`): both ultimately carry the exact same
 * `extraction`/`supplierMatch`/`ocr` triple (see `hooks/queries/use-received-invoices.ts`'s own header
 * on why the polled route mirrors the upload response), so there is exactly one place deciding what
 * to say about it, never two copies that could drift.
 *
 * "otherwise... the screen says so": a MATCHED supplier is already visible through the pre-filled
 * "Linked supplier" field itself (no toast needed); anything else, once the file WAS recognized (a
 * plain scanned PDF with nothing to match has nothing to say here), gets a named message so an
 * empty/ambiguous link is never mistaken for a missed one. OCR: `not-attempted` and `pending` both say
 * nothing here — `not-attempted` has no OCR story to tell (the pre-OCR behaviour, proven UNCHANGED),
 * `pending` isn't resolved yet (the "reading the document…" notice covers that state instead, until
 * THIS function runs again once the poll reports `done`); `unavailable` covers BOTH "no OCR service
 * deployed for this instance" and "a declining extractor" as the SAME honest absence; `extracted`
 * flags the fields below as AI-read so the human reviews rather than trusting them blindly; `failed`
 * NAMES the provider's own error — never swallowed.
 */
function notifyExtractionOutcome(
  t: ReturnType<typeof useTranslation>["t"],
  {
    extraction,
    supplierMatch,
    ocr,
  }: Pick<UploadReceivedInvoicePreview, "extraction" | "supplierMatch" | "ocr">,
) {
  if (extraction.syntax && supplierMatch.outcome !== "matched") {
    if (supplierMatch.outcome === "ambiguous") {
      toast.info(t("documents.custom.receivedInvoiceUpload.supplierAmbiguous"))
    } else {
      toast.info(t("documents.custom.receivedInvoiceUpload.supplierNotMatched"))
    }
  }

  if (ocr.outcome === "unavailable") {
    toast.info(t("documents.custom.receivedInvoiceUpload.ocrUnavailable"))
  } else if (ocr.outcome === "extracted") {
    toast.info(t("documents.custom.receivedInvoiceUpload.ocrExtracted"))
  } else if (ocr.outcome === "failed") {
    toast.error(t("documents.custom.receivedInvoiceUpload.ocrFailed", { message: ocr.message }))
  }
}

/**
 * The entry point into creating a received-invoice: a file (PDF, or XML CII/
 * UBL, or Factur-X) is uploaded FIRST, structurally extracted best-effort, and the result seeds a
 * normal `DocumentCreateDialog` — the user reviews/edits exactly like any other document type's
 * create form, then the generic "receive" action persists it and the dialog itself lands on the
 * new record's own page (see that component's header). Registered at "list-header-extra"
 * (custom-slots.ts) — additive, next to the generic "New" button document-list.tsx always renders.
 *
 * Two dialogs, two stages, deliberately not merged into one: the upload step has no document fields
 * to show yet (only a file picker), and the review step has no file picker to show anymore (the file
 * is already stored — see the descriptor's own header on why `fileRef` is never a re-typable field).
 *
 * OCR of a scanned PDF can now run as a BACKGROUND job rather than inside the upload request itself
 * (that request used to take up to 60s under load): an `outcome: "pending"` upload still opens the
 * review dialog immediately, empty where OCR would have filled it, and polls
 * `useReceivedInvoiceOcrResult` for the real result while showing a "reading the document…" notice
 * (`DocumentCreateDialog`'s own `notice` prop). If the user saves before the job finishes, the
 * BACKEND fills the saved record's own empty fields itself and publishes a document event — this
 * screen has nothing to do in that case but stop polling, which closing the dialog already achieves
 * (see `onOpenChange` below, the single point both a close AND a successful save funnel through).
 */
function ReceivedInvoiceUploadButton({ descriptor }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<UploadReceivedInvoicePreview | null>(null)
  // The fileRef of an `outcome: "pending"` upload's still-running background OCR job — `null`
  // whenever there is nothing left to poll for (no upload yet, the job already finished, the job
  // 404'd, or the review dialog closed/saved — see the poll-completion effect and `onOpenChange`
  // below, the two places this is cleared). Doubles as "is the reading notice shown right now": both
  // read off this single flag rather than keeping a second boolean in sync with it.
  const [pendingOcrFileRef, setPendingOcrFileRef] = useState<string | null>(null)
  // The OCR job's own fields, once it finishes — handed to `DocumentCreateDialog` as `lateData` (see
  // that prop's own header on `use-document-form.ts`): merged into the form WITHOUT overwriting
  // anything already typed, unlike `initialData` below which only ever seeds the form at open time.
  const [lateData, setLateData] = useState<Record<string, unknown> | undefined>(undefined)

  const upload = useUploadReceivedInvoice()
  const ocrPoll = useReceivedInvoiceOcrResult(pendingOcrFileRef)

  // `use-document-form.ts`'s own reset effect keys off `initialData`'s OBJECT IDENTITY, not its
  // content, specifically so a background refetch (`refetchOnWindowFocus`, an SSE tick) never wipes
  // out what the user is mid-typing — see that effect's own comment. Calling `buildInitialData(preview)`
  // straight in the JSX below defeated that: it allocates a NEW object on every render of THIS
  // component, and this component re-renders for reasons that have nothing to do with `preview`
  // itself (any parent re-render, `dragOver`/`uploadDialogOpen` flipping, an unrelated SSE event
  // higher up the tree) — each one silently reset the review form back to the extracted values,
  // discarding whatever the user had just corrected. Memoizing on `preview`'s own reference (which
  // only ever changes via `setPreview` above) is what keeps the object — and the form — stable across
  // every OTHER re-render. For a `pending` upload, `preview.extraction.fields` is the empty
  // placeholder the contract promises (`{ syntax: null, fields: {} }`) — nothing to seed yet, the
  // fields the OCR job eventually finds arrive later through `lateData` instead.
  const initialData = useMemo(() => (preview ? buildInitialData(preview) : undefined), [preview])

  // Reacts to the background OCR job this dialog is waiting on — mirrors `notifyExtractionOutcome`'s
  // own header on why a `pending` upload says nothing itself: this is where that story concludes,
  // whichever way it goes.
  useEffect(() => {
    if (!pendingOcrFileRef) return
    if (ocrPoll.data?.status === "done") {
      setLateData(ocrPoll.data.extraction.fields)
      notifyExtractionOutcome(t, ocrPoll.data)
      setPendingOcrFileRef(null) // stops the poll (query disables) and removes the notice.
      return
    }
    // A 404 (job unknown/expired — see `useReceivedInvoiceOcrResult`'s own header) is TERMINAL: there
    // is nothing left to merge and nothing honest to say (the OCR outcome is simply unknown now), so
    // this just drops the "reading…" state rather than showing an error for something the user never
    // asked about directly.
    if (ocrPoll.isError) {
      setPendingOcrFileRef(null)
    }
  }, [ocrPoll.data, ocrPoll.isError, pendingOcrFileRef, t])

  const resetUploadDialog = () => {
    setDragOver(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFile = async (file: File) => {
    try {
      const result = await upload.mutateAsync(buildFileUploadForm(file))
      setUploadDialogOpen(false)
      resetUploadDialog()
      setPreview(result)
      setLateData(undefined)
      // Only a `pending` outcome has anything left to wait for — every other outcome (including
      // `not-attempted`) is already final the instant the upload responds, exactly as before.
      setPendingOcrFileRef(result.ocr.outcome === "pending" ? result.fileRef : null)

      // Safe to call unconditionally for EVERY outcome, `pending` included: `extraction.syntax` is
      // `null` and `ocr.outcome` is `"pending"` in that case (the upload contract's own empty
      // placeholder), so none of `notifyExtractionOutcome`'s branches fire — the "reading the
      // document…" notice is the only thing shown until the poll effect above calls this again with
      // the real outcome.
      notifyExtractionOutcome(t, result)
    } catch (error) {
      // A 413 is refused by multer at the multipart wire itself (limits.fileSize), before this file
      // ever reaches ReceivedInvoicesService — its own body carries the generic "File too large"
      // rather than this app's own byte-counted message, so it gets a dedicated, translated string
      // instead. Every OTHER refusal keeps the backend's OWN message — it names the exact duplicate
      // (SHA-256 + existing document id) when that is the refusal, never a generic "upload failed"
      // that would hide it.
      if (error instanceof ApiError && error.status === 413) {
        toast.error(t("documents.custom.receivedInvoiceUpload.tooLarge"))
      } else {
        toast.error(
          error instanceof ApiError ? error.message : t("documents.custom.receivedInvoiceUpload.error"),
        )
      }
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void handleFile(file)
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
            <p className="text-xs text-muted-foreground">
              {t("documents.custom.receivedInvoiceUpload.maxSize")}
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
        <DocumentCreateDialog
          descriptor={descriptor}
          open
          onOpenChange={(open) => {
            if (open) return
            // Closing the dialog OR a successful save (`DocumentCreateDialog`'s own
            // `onActionSuccess` calls this with `false` too) both fall through here — either way
            // there is nothing left to wait for: a save-before-completion is filled in by the
            // BACKEND itself (see this component's own module header), so the only thing left for
            // this screen to do is stop asking.
            setPreview(null)
            setPendingOcrFileRef(null)
            setLateData(undefined)
          }}
          initialData={initialData}
          lateData={lateData}
          notice={
            pendingOcrFileRef ? (
              <div
                className="mb-4 flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground"
                data-cy="received-invoice-ocr-pending"
              >
                <Spinner />
                <span>{t("documents.custom.receivedInvoiceUpload.ocrPending")}</span>
              </div>
            ) : undefined
          }
        />
      )}
    </>
  )
}

registerDocumentCustomComponent("received-invoice", "list-header-extra", ReceivedInvoiceUploadButton)

export { ReceivedInvoiceUploadButton }

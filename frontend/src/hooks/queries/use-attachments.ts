import { useApiMutation } from "@/hooks/use-api-query"
import { authenticatedFetch } from "@/hooks/use-fetch"

/**
 * Backs the 'file' field kind (field-renderers/file-field.tsx) — a company-scoped, content-addressed
 * attachment, NOT tied to any one document type or instance (mirrors the genericity
 * `/api/documents/references/:entity/...` already holds for 'reference': the kind's own machinery
 * lives at this generic layer, never duplicated per document type). Backend: documents/attachments/
 * (reusing received-invoices/storage.ts's own persistence — see that module's header).
 */
export interface AttachmentRef {
  fileRef: string
  fileName: string
  mime: string
}

/** `POST /api/documents/attachments/upload` (multipart/form-data, a single `file` part — the 2026-09-17
 *  decision replacing the old base64-in-JSON convention, which was itself capped at ~750 KiB only
 *  because it had to fit under the backend's own 1 MiB JSON body-parser limit after base64 inflation)
 *  — refused (a NAMED ApiError) for a disallowed mime or an oversized file; an allowed file always
 *  succeeds. No `invalidateKeys`: nothing in the documents list changes until the caller actually saves
 *  the field's value onto a document (the same posture `useUploadReceivedInvoice`'s own header already
 *  documents for its own upload). */
export function useUploadAttachment() {
  return useApiMutation<FormData, AttachmentRef>("POST", "/api/documents/attachments/upload")
}

/** Builds the single-part `FormData` body both upload mutations in this app send — one `file` field,
 *  the browser's own `File` object untouched (no base64 re-encoding: multer reads the multipart stream
 *  directly on the backend). Shared here rather than duplicated per caller, unlike the backend's own
 *  small per-route duplications: this one is genuinely the SAME three-line construction for every
 *  caller, with nothing route-specific in it. */
export function buildFileUploadForm(file: File): FormData {
  const form = new FormData()
  form.append("file", file)
  return form
}

/** `GET /api/documents/attachments/:fileRef?mime=...` — the raw bytes back, as a `Blob` whose own
 *  `type` is the response's `Content-Type` header (what lets an `<img src={URL.createObjectURL(blob)}
 *  >` in file-field.tsx actually render for an image mime, exactly the way the file was stored). Not
 *  a `useApiQuery` (react-query) call: a `Blob`/object-URL has an imperative lifecycle (create,
 *  revoke on cleanup) the caller itself owns — the same reasoning
 *  `custom/received-invoice-download-button.tsx`'s own `handleDownload` already follows for its file
 *  download. */
export async function downloadAttachment(fileRef: string, mime: string): Promise<Blob> {
  const response = await authenticatedFetch(
    `/api/documents/attachments/${fileRef}?mime=${encodeURIComponent(mime)}`,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || `HTTP ${response.status}`)
  }
  return response.blob()
}

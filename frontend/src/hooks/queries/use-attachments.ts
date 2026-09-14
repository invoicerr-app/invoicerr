import { useApiMutation } from "@/hooks/use-api-query"
import { authenticatedFetch } from "@/hooks/use-fetch"

/**
 * Backs the 'file' field kind (field-renderers/file-field.tsx) — a company-scoped, content-addressed
 * attachment, NOT tied to any one document type or instance (mirrors the genericity
 * `/api/documents/references/:entity/...` already holds for 'reference': the kind's own machinery
 * lives at this generic layer, never duplicated per document type). Backend: documents/attachments/
 * (reusing received-invoices/storage.ts's own persistence — see that module's header).
 */
export interface UploadAttachmentVariables {
  fileName: string
  mime: string
  /** Base64-encoded raw file bytes — same wire convention every other binary upload in this frontend
   *  already uses (see file-field.tsx's own `fileToBase64`). */
  base64: string
}

export interface AttachmentRef {
  fileRef: string
  fileName: string
  mime: string
}

/** `POST /api/documents/attachments/upload` — refused (a NAMED ApiError) for a disallowed mime or an
 *  oversized file; an allowed file always succeeds. No `invalidateKeys`: nothing in the documents
 *  list changes until the caller actually saves the field's value onto a document (the same posture
 *  `useUploadReceivedInvoice`'s own header already documents for its own upload). */
export function useUploadAttachment() {
  return useApiMutation<UploadAttachmentVariables, AttachmentRef>("POST", "/api/documents/attachments/upload")
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

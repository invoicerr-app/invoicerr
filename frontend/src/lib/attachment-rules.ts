import type { TFunction } from "i18next"
import { toast } from "sonner"

import { ApiError } from "@/hooks/use-api-query"

/** The file types an uploaded attachment may be: the file field's picker and the proof of a manual
 *  quote acceptance (the backend's own rule in `actions/quote-manual-acceptance.ts`). Checked here
 *  only to refuse early; the backend re-checks. */
export const ATTACHMENT_MIMES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]

/** The size the manual-acceptance dialog refuses before uploading (10 MB). Mirrors the backend upload
 *  limit, `backend/src/modules/documents/attachments/attachments.service.ts#MAX_ATTACHMENT_BYTES`. */
export const ACCEPTANCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * The toast for a failed upload. A 413 is refused by multer at the multipart wire itself
 * (limits.fileSize): its body carries the generic "File too large" rather than this app's own
 * byte-counted message, so that status gets a dedicated, translated string instead of the raw backend
 * text (`tooLargeMessage` when the caller words it itself, the attachment wording otherwise). Any
 * other API error shows its own message (a refused duplicate names the existing document), anything
 * else the caller's `fallbackMessage`. Both are translated at the call site, so the i18n check still
 * sees their keys.
 */
export function toastUploadError(
  error: unknown,
  t: TFunction,
  fallbackMessage: string,
  tooLargeMessage?: string,
): void {
  if (error instanceof ApiError && error.status === 413) {
    toast.error(tooLargeMessage ?? t("documents.form.file.tooLarge"))
  } else {
    toast.error(error instanceof ApiError ? error.message : fallbackMessage)
  }
}

import { useApiMutation } from "@/hooks/use-api-query"

/**
 * Root TODO item 18 ("réception de factures") — the ONE bespoke endpoint this type needs beyond the
 * fully generic document machinery (`use-document-types.ts` already covers listing, the descriptor,
 * and running "receive"/"approve"/"reject"/"delete" through `useRunDocumentAction`). Kept in its own
 * file, mirroring `use-document-schedules.ts`'s own placement, rather than folded into
 * `use-document-types.ts` — a genuinely separate concern (uploading a file has no document instance
 * to act on yet), the same reasoning the backend's own `received-invoices/` module gives for not
 * living inside `documents-core.module.ts`.
 */
export interface UploadReceivedInvoiceVariables {
  fileName: string
  mime: string
  /** Base64-encoded raw file bytes — same wire convention the signing-certificates upload already
   *  uses (see settings/_components/signing-certificates.settings.tsx's own `pfxBase64`). */
  base64: string
}

/** Mirrors the backend's `UploadReceivedInvoicePreview` (received-invoices.service.ts). Never a
 *  persisted document — see that file's own header: this is a PREVIEW the upload dialog feeds
 *  straight into a pre-filled "create received-invoice" form. */
export interface UploadReceivedInvoicePreview {
  fileRef: string
  fileName: string
  mime: string
  extraction: {
    /** null when nothing recognizable was found (a plain scanned PDF, an unknown XML dialect) —
     *  never a refusal by itself, only an exact repeat (same SHA-256) is (see the mutation below). */
    syntax: string | null
    fields: Record<string, unknown>
  }
}

/** `POST /api/documents/received-invoices/upload` — refuses (a NAMED `ApiError`) only an exact
 *  repeat of an already-received file; an unrecognized file still succeeds, with an empty
 *  `extraction.fields`. No `invalidateKeys`: nothing in the documents list changes until the user
 *  actually confirms via the "receive" action (`useRunDocumentAction`), which already invalidates
 *  `["documents"]` on its own. */
export function useUploadReceivedInvoice() {
  return useApiMutation<UploadReceivedInvoiceVariables, UploadReceivedInvoicePreview>(
    "POST",
    "/api/documents/received-invoices/upload",
  )
}

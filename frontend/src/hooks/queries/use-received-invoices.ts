import { ApiError, useApiMutation, useApiQuery } from "@/hooks/use-api-query"

/**
 * Invoice reception — the ONE bespoke endpoint this type needs beyond the
 * fully generic document machinery (`use-document-types.ts` already covers listing, the descriptor,
 * and running "receive"/"approve"/"reject"/"record-payment"/"delete" through `useRunDocumentAction` —
 * "reject" and "record-payment" both declare `params`, so `useDocumentActionRunner` opens the SAME
 * generic params dialog every other parameterized action already uses, no bespoke UI needed). Kept in
 * its own
 * file, mirroring `use-document-schedules.ts`'s own placement, rather than folded into
 * `use-document-types.ts` — a genuinely separate concern (uploading a file has no document instance
 * to act on yet), the same reasoning the backend's own `received-invoices/` module gives for not
 * living inside `documents-core.module.ts`.
 */
/** Mirrors the backend's `SupplierMatchResult`
 *  (received-invoices/supplier-reconciliation.ts). `outcome: 'matched'` means `extraction.fields`
 *  below ALSO carries a `supplierClient` id (the SAME generic pre-fill mechanism every other
 *  extracted field already uses — see `buildInitialData` in
 *  `custom/received-invoice-upload-button.tsx`); anything else, the screen says so (see that file). */
export type SupplierMatchResult =
  | { outcome: "matched"; clientId: string; matchedBy: "vat" | "name" }
  | { outcome: "unmatched"; reason: "no-criteria" | "not-found" }
  | { outcome: "ambiguous"; matchedBy: "vat" | "name"; candidateIds: string[] }

/**
 * Mirrors the backend's `OcrOutcome`
 * (`received-invoices/ocr/apply-ocr-fallback.ts`). OCR is tried ONLY for a PDF that carried nothing
 * structural at all — every other deposit (XML, or a PDF that already had embedded CII) reports
 * `not-attempted`. `unavailable` covers BOTH "no OCR service deployed for this instance"
 * (`OCR_SERVICE_URL` unset — the self-host default) AND a registered-but-declining extractor: the
 * screen only ever needs ONE honest "no OCR here, fill in by hand" message either way (see
 * `custom/received-invoice-upload-button.tsx`'s own header for why the two are never distinguished
 * on screen).
 *
 * `pending` is the fifth, ASYNC variant: OCR now runs as a background job rather than inside the
 * upload request itself (the request used to take up to 60s under load — see this repo's own
 * history). When the upload answers `pending`, the upload response's own `extraction`/`supplierMatch`
 * are both EMPTY placeholders (`{ syntax: null, fields: {} }` / `{ outcome: "unmatched", reason:
 * "no-criteria" }`) — nothing to show for either yet — and the real result is fetched separately via
 * `useReceivedInvoiceOcrResult` below. `pending` is impossible when OCR isn't configured on this
 * instance at all: that path still answers synchronously, exactly as before (`unavailable`).
 */
export type OcrOutcome =
  | { outcome: "not-attempted" }
  | { outcome: "unavailable" }
  | { outcome: "extracted"; extractorId: string }
  | { outcome: "failed"; extractorId: string; message: string }
  | { outcome: "pending" }

/** Mirrors the backend's `UploadReceivedInvoicePreview` (received-invoices.service.ts). Never a
 *  persisted document — see that file's own header: this is a PREVIEW the upload dialog feeds
 *  straight into a pre-filled "create received-invoice" form. */
export interface UploadReceivedInvoicePreview {
  fileRef: string
  fileName: string
  mime: string
  extraction: {
    /** null when nothing recognizable was found (a plain scanned PDF, an unknown XML dialect) —
     *  never a refusal by itself, only an exact repeat (same SHA-256) is (see the mutation below).
     *  `"OCR"` once the OCR fallback (`apply-ocr-fallback.ts`) filled `fields` from the OCR service instead. */
    syntax: string | null
    fields: Record<string, unknown>
  }
  supplierMatch: SupplierMatchResult
  ocr: OcrOutcome
}

/** `POST /api/documents/received-invoices/upload` (multipart/form-data, a single `file` part — see
 *  `use-attachments.ts#buildFileUploadForm`, reused here) — refuses (a NAMED `ApiError`) only an exact
 *  repeat of an already-received file; an unrecognized file still succeeds, with an empty
 *  `extraction.fields`. No `invalidateKeys`: nothing in the documents list changes until the user
 *  actually confirms via the "receive" action (`useRunDocumentAction`), which already invalidates
 *  `["documents"]` on its own. */
export function useUploadReceivedInvoice() {
  return useApiMutation<FormData, UploadReceivedInvoicePreview>(
    "POST",
    "/api/documents/received-invoices/upload",
  )
}

/** The result of the background OCR job an `outcome: "pending"` upload started — `GET
 *  /api/documents/received-invoices/upload/:fileRef/ocr`. Once `status` is `"done"`,
 *  `extraction`/`supplierMatch`/`ocr` carry the EXACT same shape and meaning as the synchronous
 *  upload response's own three fields (`UploadReceivedInvoicePreview` above) — `ocr` is then never
 *  `"pending"` again, the job having already finished. */
export type ReceivedInvoiceOcrResult =
  | { status: "pending" }
  | {
      status: "done"
      extraction: { syntax: string | null; fields: Record<string, unknown> }
      supplierMatch: SupplierMatchResult
      ocr: OcrOutcome
    }

const OCR_POLL_INTERVAL_MS = 1_500

/**
 * Polls the background OCR job for a `fileRef` an `outcome: "pending"` upload started
 * (`custom/received-invoice-upload-button.tsx`) — every `OCR_POLL_INTERVAL_MS` while the job is
 * still running, stopping the instant it reports `"done"` (no more requests once `data.status` isn't
 * `"pending"` any more — see `refetchInterval` below). `enabled: false` while `fileRef` is `null`: the
 * caller passes `null` once there's nothing left to wait for (the review dialog closed, or the record
 * was saved before the job finished — the BACKEND fills the saved record's own empty fields in that
 * case and publishes a document event, so this screen has nothing further to do but stop asking).
 *
 * A 404 means the job is unknown or has expired server-side — a TERMINAL state, not a transient
 * failure: retrying it can only ever 404 again, so it's excluded from the app-wide retry policy the
 * same way `lib/query-client.ts` already excludes a 401. The caller reads `isError`/`error` to drop
 * its own "reading…" state the moment this happens (see the upload button's own effect).
 */
export function useReceivedInvoiceOcrResult(fileRef: string | null) {
  return useApiQuery<ReceivedInvoiceOcrResult>(
    ["received-invoices", "upload-ocr", fileRef],
    `/api/documents/received-invoices/upload/${fileRef}/ocr`,
    {
      enabled: fileRef !== null,
      refetchInterval: (query) => {
        const data = query.state.data
        return data?.status === "pending" ? OCR_POLL_INTERVAL_MS : false
      },
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 404) return false
        return failureCount < 2
      },
    },
  )
}

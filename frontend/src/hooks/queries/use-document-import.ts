import { useApiMutation } from "@/hooks/use-api-query"

/**
 * Importing a document issued by a previous tool (issue #340) - the single-document endpoint and the
 * CSV bulk import, both bespoke routes (never `/documents/types/:typeId/actions/:actionId`) - see the
 * backend's own `document-import.service.ts` header for why: a creation that must land somewhere
 * other than the type's own "draft" cannot go through the generic action pipeline at all.
 */

export interface ImportOriginalFileRef {
  fileRef: string
  fileName: string
  mime: string
}

export interface ImportTransmissionEvidence {
  sdiId?: string
  ksefNumber?: string
  paReference?: string
  atcud?: string
}

export interface ImportDocumentVariables {
  typeId: string
  data: Record<string, unknown>
  originalNumber: string
  transmissionEvidence: ImportTransmissionEvidence
  originalFile: ImportOriginalFileRef
}

export interface ImportDocumentResult {
  id: string
  typeId: string
  status: "imported"
  displayNumber: string
  transmitted: boolean
}

/** `POST /api/documents/types/:typeId/import` - one document, created directly as "imported". */
export function useImportDocument() {
  return useApiMutation<ImportDocumentVariables, ImportDocumentResult>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/import`,
    { invalidateKeys: [["documents"]] },
  )
}

export interface DocumentImportCsvRow {
  rowNumber: number
  issueDate?: string
  currency?: string
  notes?: string
  originalNumber?: string
  originalFileName?: string
  transmissionSdiId?: string
  transmissionKsefNumber?: string
  transmissionPaReference?: string
  transmissionAtcud?: string
  lineDescription?: string
  lineQuantity?: string
  lineUnit?: string
  lineUnitPrice?: string
  lineVatRate?: string
  lineDiscountPercent?: string
  clientId?: string
  dueDate?: string
  clientReference?: string
  reason?: string
}

export interface DocumentImportCsvRowResultWire {
  rowNumber: number
  status: "valid" | "rejected"
  errors?: string[]
}

export interface DocumentImportCsvPreviewResult {
  rows: DocumentImportCsvRowResultWire[]
  summary: { total: number; willImport: number; rejected: number }
}

export interface DocumentImportCsvConfirmResult {
  imported: number
  rejected: number
}

export interface DocumentImportCsvVariables {
  typeId: string
  rows: DocumentImportCsvRow[]
  files: Record<string, ImportOriginalFileRef>
}

/** `POST /api/documents/types/:typeId/import/csv/preview` - writes nothing. */
export function useImportDocumentsCsvPreview() {
  return useApiMutation<DocumentImportCsvVariables, DocumentImportCsvPreviewResult>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/import/csv/preview`,
  )
}

/** `POST /api/documents/types/:typeId/import/csv/confirm` - imports every valid row. */
export function useImportDocumentsCsvConfirm() {
  return useApiMutation<DocumentImportCsvVariables, DocumentImportCsvConfirmResult>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/import/csv/confirm`,
    { invalidateKeys: [["documents"]] },
  )
}

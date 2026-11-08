import { useApiMutation } from "@/hooks/use-api-query"
import type { ClientImportRowWire } from "@/lib/csv-import/client-rows"
import type { DocumentImportCsvRow } from "./use-document-import"

/**
 * Detection and column mapping for Abby, Henrri and Tiime exports (issue #759). The backend owns
 * the profiles as data; this hook only carries the parsed file to it and returns rows shaped for the
 * SAME preview/confirm calls the generic imports already use. `detected: false` is a normal answer:
 * the dialog then keeps its template path.
 */
export interface VendorExportPreviewInput {
  headers: string[]
  rows: string[][]
}

export interface VendorMappedClientRowWire {
  rowNumber: number
  status: "mapped" | "rejected" | "duplicate"
  row: ClientImportRowWire
  errors?: string[]
  duplicateOfRow?: number
}

export interface VendorMappedDocumentRowWire {
  rowNumber: number
  status: "mapped" | "rejected" | "duplicate"
  row: DocumentImportCsvRow
  errors?: string[]
  duplicateOfRow?: number
}

interface VendorExportBase {
  detected: boolean
  kind: "clients" | "invoices"
  reason?: string
}

export interface VendorClientExportResult extends VendorExportBase {
  detected: true
  vendor: "abby" | "henrri" | "tiime"
  vendorLabel: string
  profileId: string
  label: string
  rows: VendorMappedClientRowWire[]
}

export interface VendorDocumentExportResult extends VendorExportBase {
  detected: true
  vendor: "abby" | "henrri" | "tiime"
  vendorLabel: string
  profileId: string
  label: string
  rows: VendorMappedDocumentRowWire[]
}

export type VendorExportNotDetected = VendorExportBase & { detected: false }

export function useVendorClientsPreview() {
  return useApiMutation<VendorExportPreviewInput, VendorClientExportResult | VendorExportNotDetected>(
    "POST",
    () => "/api/imports/vendor/clients/preview",
  )
}

export function useVendorDocumentsPreview() {
  return useApiMutation<
    VendorExportPreviewInput & { typeId: string },
    VendorDocumentExportResult | VendorExportNotDetected
  >("POST", () => "/api/imports/vendor/documents/preview")
}

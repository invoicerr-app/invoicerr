import type { TFunction } from "i18next"
import { toast } from "sonner"

import { authenticatedFetch } from "@/hooks/use-fetch"

/**
 * The two plain-GET downloads a document offers — its rendered PDF, and one of its normalized XML
 * syntaxes — shared by the list's row cluster (document-list.tsx) and the detail page's actions
 * menu (document-detail.tsx), so the exact same request, the same error surfacing and the same
 * "open the blob in a new tab" delivery run from both places.
 *
 * `authenticatedFetch`, NOT `fetch`: the frontend and the API live on different ports. A relative
 * fetch goes to the Vite dev server -- which has no API -- without a session cookie. The button was
 * therefore DEAD once, and the e2e didn't catch it: it only checked that it existed.
 */

export type DocumentXmlSyntax = "cii" | "ubl" | "facturx" | "peppol-bis" | "xrechnung"

/** Every syntax the menus offer, in display order, with the i18n key of its label. */
export const DOCUMENT_XML_SYNTAXES: { syntax: DocumentXmlSyntax; labelKey: string }[] = [
  { syntax: "cii", labelKey: "documents.list.downloadXmlCii" },
  { syntax: "ubl", labelKey: "documents.list.downloadXmlUbl" },
  { syntax: "facturx", labelKey: "documents.list.downloadXmlFacturx" },
  { syntax: "peppol-bis", labelKey: "documents.list.downloadXmlPeppolBis" },
  { syntax: "xrechnung", labelKey: "documents.list.downloadXmlXrechnung" },
]

function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
}

export async function downloadDocumentPdf(typeId: string, documentId: string, t: TFunction) {
  try {
    const response = await authenticatedFetch(`/api/documents/${documentId}/pdf?typeId=${typeId}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    openBlob(await response.blob())
  } catch (error) {
    // The backend's own message, not a generic one: "the PDF engine is unavailable" and "document
    // not found" don't call for the same reaction.
    toast.error(error instanceof Error ? error.message : t("documents.list.downloadPdfError"))
  }
}

export async function downloadDocumentXml(
  typeId: string,
  documentId: string,
  syntax: DocumentXmlSyntax,
  t: TFunction,
) {
  try {
    const response = await authenticatedFetch(
      `/api/documents/${documentId}/formats/${syntax}?typeId=${typeId}`,
    )
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      // `body.message` alone is the GENERIC "failed EN 16931 validation" wrapper — the actual named
      // rule (BR-DE-1, BR-DE-15, ...) lives in `body.errors` (documents.service.ts#downloadDocument
      // Format's own "THE GATE" comment). A named refusal (e.g. "download an xrechnung export with
      // no IBAN on file") must actually SAY which rule/field
      // is missing, not just that something failed — the generic message alone used to hide it.
      const detail = Array.isArray(body?.errors) && body.errors.length ? body.errors.join(" — ") : null
      throw new Error(detail || body?.message || `HTTP ${response.status}`)
    }
    openBlob(await response.blob())
  } catch (error) {
    // The backend's OWN message — it cites the failing BR-* rule when validation is what refused
    // it, and a generic fallback would hide exactly the information the gate exists
    // to surface.
    toast.error(error instanceof Error ? error.message : t("documents.list.downloadXmlError"))
  }
}

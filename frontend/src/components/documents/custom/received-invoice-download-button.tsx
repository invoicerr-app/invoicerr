import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Download } from "lucide-react"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { Button } from "@/components/ui/button"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { openBlob, responseErrorMessage } from "@/lib/download"

/**
 * The "download the original file" button — registered at "list-row-extra"
 * (custom-slots.ts), the SAME slot custom/invoice-correction-routes-button.tsx uses for "invoice",
 * next to the generic pdf icon every row already renders. `GET /api/documents/received-invoices/:id/
 * file` (received-invoices.controller.ts) streams back the ORIGINAL uploaded bytes, verbatim, with
 * their own filename/mime — never re-derived, never re-rendered.
 */
function ReceivedInvoiceDownloadButton({ instance }: DocumentCustomSlotProps) {
  const { t } = useTranslation()

  const handleDownload = async () => {
    if (!instance) return // Unreachable in practice — this slot is only ever rendered per-row.
    try {
      // `authenticatedFetch`, not a plain `<a href>` — same cross-port/cookie reasoning
      // document-downloads.ts's own header explains for the PDF download.
      const response = await authenticatedFetch(`/api/documents/received-invoices/${instance.id}/file`)
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response))
      }
      openBlob(await response.blob())
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("documents.custom.receivedInvoiceDownload.error"),
      )
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("documents.custom.receivedInvoiceDownload.button")}
      tooltip={t("documents.custom.receivedInvoiceDownload.button")}
      onClick={(event) => {
        event.stopPropagation()
        void handleDownload()
      }}
      dataCy={`document-custom-received-invoice-download-button-${instance?.id}`}
    >
      <Download className="h-4 w-4" />
    </Button>
  )
}

registerDocumentCustomComponent("received-invoice", "list-row-extra", ReceivedInvoiceDownloadButton)

export { ReceivedInvoiceDownloadButton }

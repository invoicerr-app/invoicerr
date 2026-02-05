import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState } from "react"

import type { Receipt } from "@/types"
import { useGetRaw } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

type ReceiptPdfModalProps = {
  receipt: Receipt | null
  onOpenChange: (open: boolean) => void
}

export function ReceiptPdfModal({ receipt, onOpenChange }: ReceiptPdfModalProps) {
  const { t } = useTranslation()
  const { data } = useGetRaw<Response>(`/api/receipts/${receipt?.id}/pdf`)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)

  useEffect(() => {
    if (data) {
      data.arrayBuffer().then((buffer) => {
        setPdfData(new Uint8Array(buffer))
      })
    }
  }, [data])

  if (!receipt) return null

  return (
    <Dialog
      open={!!receipt}
      onOpenChange={(open) => {
        if (!open) {
          setPdfData(null)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="!max-w-none w-fit min-w-[90vw] md:min-w-128 h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("receipts.pdf.title", { number: receipt.rawNumber || receipt.number })}</DialogTitle>
        </DialogHeader>

        <section className="h-full overflow-auto">
          {pdfData ? (
            <div className="flex justify-center h-full overflow-auto">
              <iframe
                className="w-full h-full"
                src={`data:application/pdf;base64,${btoa(String.fromCharCode(...pdfData))}`}
                title={t("receipts.pdf.title", { number: receipt.rawNumber || receipt.number })}
              />
            </div>
          ) : (
            <section className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </section>
          )}
        </section>
      </DialogContent>
    </Dialog >
  )
}

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState } from "react"

import type { Payment } from "@/types"
import { useGetRaw } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

type PaymentPdfModalProps = {
  payment: Payment | null
  onOpenChange: (open: boolean) => void
}

export function PaymentPdfModal({ payment, onOpenChange }: PaymentPdfModalProps) {
  const { t } = useTranslation()
  const { data } = useGetRaw<Response>(payment ? `/api/payments/${payment.id}/pdf` : null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)

  useEffect(() => {
    if (data) {
      data.arrayBuffer().then((buffer) => {
        setPdfData(new Uint8Array(buffer))
      })
    }
  }, [data])

  if (!payment) return null

  return (
    <Dialog
      open={!!payment}
      onOpenChange={(open) => {
        if (!open) {
          setPdfData(null)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="!max-w-6xl w-[95vw] h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("payments.pdf.title", { number: payment.rawNumber || payment.number })}</DialogTitle>
        </DialogHeader>

        <section className="h-full overflow-auto">
          {pdfData ? (
            <div className="flex justify-center h-full overflow-auto">
              <iframe
                className="w-full h-full"
                src={`data:application/pdf;base64,${btoa(String.fromCharCode(...pdfData))}`}
                title={t("payments.pdf.title", { number: payment.rawNumber || payment.number })}
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

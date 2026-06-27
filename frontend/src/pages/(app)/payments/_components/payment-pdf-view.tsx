import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
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

  const pdfBase64 = pdfData ? btoa(String.fromCharCode(...pdfData)) : null

  const handleDownload = () => {
    if (!pdfBase64) return
    const link = document.createElement("a")
    link.href = `data:application/pdf;base64,${pdfBase64}`
    link.download = `payment-${payment.rawNumber || payment.number}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

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
        <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
          <DialogTitle>{t("payments.pdf.title", { number: payment.rawNumber || payment.number })}</DialogTitle>
          <Button type="button" variant="outline" size="sm" onClick={handleDownload} disabled={!pdfBase64}>
            <Download className="h-4 w-4 mr-2" />
            {t("payments.list.tooltips.downloadPdf")}
          </Button>
        </DialogHeader>

        <section className="h-full overflow-auto">
          {pdfBase64 ? (
            <div className="flex justify-center h-full overflow-auto">
              <iframe
                className="w-full h-full"
                src={`data:application/pdf;base64,${pdfBase64}#zoom=page-fit`}
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
    </Dialog>
  )
}

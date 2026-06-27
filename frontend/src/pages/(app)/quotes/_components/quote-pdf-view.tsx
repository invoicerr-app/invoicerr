import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import type { Quote } from "@/types"
import { useGetRaw } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"

type QuotePdfModalProps = {
  quote: Quote | null
  onOpenChange: (open: boolean) => void
}

export function QuotePdfModal({ quote, onOpenChange }: QuotePdfModalProps) {
  const { t } = useTranslation()
  const { data } = useGetRaw<Response>(quote ? `/api/quotes/${quote.id}/pdf` : null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    if (data) {
      data.arrayBuffer().then((buffer) => {
        setPdfData(new Uint8Array(buffer))
      })
    }
  }, [data])

  useEffect(() => {
    if (pdfData) {
      const blob = new Blob([pdfData], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)

      return () => {
        URL.revokeObjectURL(url)
      }
    } else {
      setPdfUrl(null)
    }
  }, [pdfData])

  if (!quote) return null

  const handleDownload = () => {
    if (!pdfUrl) return
    const link = document.createElement("a")
    link.href = pdfUrl
    link.download = `quote-${quote.number}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Dialog
      open={!!quote}
      onOpenChange={(open) => {
        if (!open) {
          setPdfData(null)
          setPdfUrl(null)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="!max-w-6xl w-[95vw] h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
          <DialogTitle>{t("quotes.pdf.title", { number: quote?.number })}</DialogTitle>
          <Button type="button" variant="outline" size="sm" onClick={handleDownload} disabled={!pdfUrl}>
            <Download className="h-4 w-4 mr-2" />
            {t("quotes.list.tooltips.downloadPdf")}
          </Button>
        </DialogHeader>

        <section className="h-full overflow-auto">
          {pdfUrl ? (
            <div className="flex justify-center h-full overflow-auto">
              <iframe
                className="w-full h-full"
                src={`${pdfUrl}#zoom=page-fit`}
                title={t("quotes.pdf.title", { number: quote?.number })}
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

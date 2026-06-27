import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useEffect, useState } from "react"
import { useGet, useGetRaw } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import { Code, Download, FileText } from "lucide-react"
import type { Invoice } from "@/types"
import { useTranslation } from "react-i18next"

type InvoicePdfModalProps = {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
}

interface PluginPdfFormat {
  format_name: string
  format_key: string
}

export function InvoicePdfModal({ invoice, onOpenChange }: InvoicePdfModalProps) {
  const { t } = useTranslation()
  const { data } = useGetRaw<Response>(invoice ? `/api/invoices/${invoice.id}/pdf` : null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)

  const { data: pdf_formats } = useGet<PluginPdfFormat[]>('/api/plugins/formats')
  const [downloadTrigger, setDownloadTrigger] = useState<{
    format: string
    file_format: 'pdf' | 'xml'
    id: number
  } | null>(null)

  const { data: file } = useGetRaw<Response>(
    downloadTrigger && invoice
      ? `/api/invoices/${invoice.id}/download/${downloadTrigger.file_format}?format=${downloadTrigger.format}`
      : null,
  )

  useEffect(() => {
    if (data) {
      data.arrayBuffer().then((buffer) => {
        setPdfData(new Uint8Array(buffer))
      })
    }
  }, [data])

  useEffect(() => {
    if (downloadTrigger && file && invoice) {
      file.arrayBuffer().then((buffer) => {
        const blob = new Blob([buffer], { type: `application/${downloadTrigger.file_format}` })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `invoice-${invoice.number}-${downloadTrigger.format}.${downloadTrigger.file_format}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        setDownloadTrigger(null)
      }).catch(() => { })
    }
  }, [downloadTrigger, file, invoice])

  if (!invoice) return null

  const pdfBase64 = pdfData ? btoa(String.fromCharCode(...pdfData)) : null

  const handleDownload = ({ format, file_format }: { format: string; file_format: 'pdf' | 'xml' }) => {
    setDownloadTrigger({ format, file_format, id: Date.now() })
  }

  return (
    <Dialog
      open={!!invoice}
      onOpenChange={(open) => {
        if (!open) {
          setPdfData(null)
          setDownloadTrigger(null)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="!max-w-6xl w-[95vw] h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
          <DialogTitle>{t("invoices.pdf.title", { number: invoice?.number })}</DialogTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                {t("invoices.list.tooltips.downloadPdf")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="[&>*]:cursor-pointer w-48">
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="h-3 w-3" />
                {t("invoices.list.actions.downloadPdf")}
              </DropdownMenuLabel>

              <DropdownMenuItem onClick={() => handleDownload({ format: "", file_format: "pdf" })}>Standard</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "facturx", file_format: "pdf" })}>Factur-X</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "zugferd", file_format: "pdf" })}>ZUGFeRD</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "xrechnung", file_format: "pdf" })}>XRechnung</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "ubl", file_format: "pdf" })}>UBL</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "cii", file_format: "pdf" })}>CII</DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Code className="h-3 w-3" />
                {t("invoices.list.actions.downloadXml")}
              </DropdownMenuLabel>

              <DropdownMenuItem onClick={() => handleDownload({ format: "facturx", file_format: "xml" })}>Factur-X</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "zugferd", file_format: "xml" })}>ZUGFeRD</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "xrechnung", file_format: "xml" })}>XRechnung</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "ubl", file_format: "xml" })}>UBL</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload({ format: "cii", file_format: "xml" })}>CII</DropdownMenuItem>
              {pdf_formats?.map((format) => (
                <DropdownMenuItem
                  key={format.format_key}
                  onClick={() => handleDownload({ format: format.format_key, file_format: "xml" })}
                >
                  {format.format_name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogHeader>
        <section className="h-full overflow-auto">
          {pdfBase64 ? (
            <div className="flex justify-center h-full overflow-auto">
              <iframe
                className="w-full h-full"
                src={`data:application/pdf;base64,${pdfBase64}#zoom=page-fit`}
                title={t("invoices.pdf.title", { number: invoice?.number })}
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

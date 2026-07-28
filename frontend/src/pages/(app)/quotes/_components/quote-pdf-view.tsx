import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Download, Maximize, Pencil, ZoomIn, ZoomOut } from "lucide-react"
import type { Quote } from "@/types"
import { QuoteStatus } from "@/types"
import { QuoteFormFields, type QuoteFormValues, useQuoteForm } from "./quote-form"
import { QuotePdfSettingsPanel } from "./quote-pdf-settings-panel"
import { buildQuotePreviewData, compileQuotePreview } from "./quote-preview-template"
import type { TemplateSettings } from "../../settings/_components/pdf.settings"
import { useGetRaw, usePatch } from "@/hooks/use-fetch"
import { usePaymentMethods } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { slugifyFilename } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

type QuotePdfModalProps = {
  quote: Quote | null
  onOpenChange: (open: boolean) => void
}

export function QuotePdfModal({ quote, onOpenChange }: QuotePdfModalProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, mutate: refetchPdf } = useGetRaw<Response>(quote ? `/api/quotes/${quote.id}/pdf` : null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [settings, setSettings] = useState<TemplateSettings | null>(null)

  const { data: paymentMethods } = usePaymentMethods()
  const form = useQuoteForm(quote)
  const watchedValues = form.watch()
  const { trigger: updateQuote, loading: savingQuote } = usePatch(`/api/quotes/${quote?.id}`)

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

  const previewHtml = useMemo(() => {
    if (!quote || !settings) return ""
    return compileQuotePreview(
      buildQuotePreviewData(quote, watchedValues as QuoteFormValues, settings, paymentMethods),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, settings, paymentMethods, watchedValues])

  if (!quote) return null

  const canEdit = quote.status === QuoteStatus.DRAFT

  const handleDownload = () => {
    if (!pdfUrl) return
    const link = document.createElement("a")
    link.href = pdfUrl
    const baseName = (quote.title && slugifyFilename(quote.title)) || `quote-${quote.number}`
    link.download = `${baseName}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleSaveQuote = (values: QuoteFormValues) => {
    updateQuote(values)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.quotes.listsAll() })
        toast.success(t("quotes.upsert.messages.updateSuccess"))
        refetchPdf()
      })
      .catch((err) => {
        console.error(err)
        toast.error(t("quotes.upsert.messages.updateError"))
      })
  }

  return (
    <Dialog
      open={!!quote}
      onOpenChange={(open) => {
        if (!open) {
          setPdfData(null)
          setPdfUrl(null)
          setIsEditing(false)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent
        className={
          isEditing
            ? "!max-w-[95vw] w-[95vw] h-[90dvh] overflow-hidden flex flex-col"
            : "!max-w-3xl w-[90vw] h-[90dvh] overflow-hidden flex flex-col"
        }
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
          <DialogTitle>{t("quotes.pdf.title", { number: quote?.number })}</DialogTitle>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                type="button"
                variant={isEditing ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsEditing((prev) => {
                    const next = !prev
                    if (!next) refetchPdf()
                    return next
                  })
                }}
                tooltip={t("quotes.pdf.edit.toggle")}
              >
                <Pencil className="h-4 w-4 mr-2" />
                {t("quotes.pdf.edit.toggle")}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleDownload} disabled={!pdfUrl}>
              <Download className="h-4 w-4 mr-2" />
              {t("quotes.list.tooltips.downloadPdf")}
            </Button>
          </div>
        </DialogHeader>

        {isEditing ? (
          <ResizablePanelGroup direction="horizontal" className="!flex-1 min-h-0">
            <ResizablePanel defaultSize={25} minSize={18} maxSize={40}>
              <div className="h-full pr-4">
                <QuotePdfSettingsPanel
                  settings={settings}
                  onSettingsChange={setSettings}
                  onSaved={refetchPdf}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40} minSize={20}>
              <QuoteLivePreview html={previewHtml} title={t("quotes.pdf.title", { number: quote?.number })} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={35} minSize={20}>
              <div className="h-full flex flex-col pl-4">
                <div className="flex-1 overflow-y-auto pr-2">
                  <QuoteFormFields form={form} formId="quote-edit-form" onSubmit={handleSaveQuote} />
                </div>
                <div className="shrink-0 pt-4">
                  <Button type="submit" form="quote-edit-form" loading={savingQuote} className="w-full">
                    {t("quotes.pdf.edit.saveQuote")}
                  </Button>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  )
}

// Reference A4-ish page size (px @ 96dpi) the preview is scaled from, independent of panel width.
const PAGE_WIDTH = 794
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2

function QuoteLivePreview({ html, title }: { html: string; title: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.6)
  const [contentHeight, setContentHeight] = useState(1123)

  const fitToWidth = () => {
    const width = containerRef.current?.clientWidth
    if (width) setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (width - 32) / PAGE_WIDTH)))
  }

  useEffect(() => {
    // Keep fitting to width as the panel's actual size settles: the dialog is
    // still animating to its edit-mode width right as this mounts, and
    // react-resizable-panels itself reports a couple of intermediate sizes
    // before landing on the final one — a single early snapshot can catch a
    // too-small transient width. Re-fitting on every observed resize (not
    // just the first) always converges on the real, final size.
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => fitToWidth())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument
    if (doc?.documentElement) {
      setContentHeight(Math.max(doc.documentElement.scrollHeight, 400))
    }
  }

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center justify-center gap-1 shrink-0">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.1) * 100) / 100))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.1) * 100) / 100))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={fitToWidth}
          tooltip={t("quotes.pdf.edit.fitToWidth")}
        >
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto bg-muted/30 rounded-lg flex justify-center p-4"
      >
        <div style={{ width: PAGE_WIDTH * zoom, height: contentHeight * zoom, flexShrink: 0 }}>
          <iframe
            className="bg-white border border-border shadow-md"
            style={{
              width: PAGE_WIDTH,
              height: contentHeight,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
            srcDoc={html}
            onLoad={handleIframeLoad}
            title={title}
          />
        </div>
      </div>
    </div>
  )
}

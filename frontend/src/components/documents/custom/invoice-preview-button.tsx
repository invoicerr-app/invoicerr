import { authenticatedFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { Eye } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import { DocumentFieldValue } from "@/components/documents/field-value"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * The one REAL, working use of the custom-slot mechanism (custom-slots.ts): a "Preview" button that
 * exists for the invoice document type alone. The quote, the credit note, and every piece of the
 * generic render (document-list.tsx, document-form.tsx, the [typeId] page) have no idea this file
 * exists — it is reachable only because custom-registrations.ts imports it for its registration
 * side effect, the one place in this app allowed to name a document type by id.
 *
 * It is deliberately called a "preview", never a "PDF": this branch has NO PDF/print renderer at
 * all for the generic document model — the old one was removed along with the old, per-type
 * invoice/quote screens (see `avant-refonte-documents` in git history), and nothing here replaces
 * it. Faking a convincing-looking PDF button that quietly opens a blank tab, or worse, silently does
 * nothing, would be exactly the kind of false-green this codebase is careful never to ship elsewhere
 * (see the KSeF/PDP live-testing discipline in MEMORY.md — a green screen that proves nothing about
 * the real capability). What this button does instead is small but entirely real: it reads the
 * invoice's OWN stored data back through the exact same field-by-KIND formatter the list's columns
 * use (field-value.tsx) and says, in the dialog itself, that this is a data preview, not a rendered
 * document — honest about the gap instead of hiding it.
 */
function InvoicePreviewButton({ descriptor, instance }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleDownloadPdf = async () => {
    try {
      // `authenticatedFetch`, PAS `fetch` : le front et l'API vivent sur des ports différents. Un
      // fetch relatif part vers le serveur Vite — qui n'a pas d'API — sans cookie de session. Le
      // bouton était donc MORT, et l'e2e ne le voyait pas : il ne vérifiait que son existence.
      // Troisième bouton mort de cette famille dans ce dépôt.
      const response = await authenticatedFetch(`/api/documents/${instance.id}/pdf?typeId=${descriptor.id}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
    } catch (error) {
      // Le message du backend, pas un générique : « le moteur PDF est indisponible » et « document
      // introuvable » n'appellent pas la même réaction.
      toast.error(error instanceof Error ? error.message : t("documents.list.downloadPdfError"))
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tooltip={t("documents.custom.invoicePreview.button")}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        dataCy="document-custom-invoice-preview-button"
      >
        <Eye className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          data-cy="document-custom-invoice-preview-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {t("documents.custom.invoicePreview.title", { label: descriptor.label })}
            </DialogTitle>
          </DialogHeader>

          <Alert data-cy="document-custom-invoice-preview-disclaimer">
            <Eye />
            <AlertTitle>{t("documents.custom.invoicePreview.previewTitle")}</AlertTitle>
            <AlertDescription>
              {t("documents.custom.invoicePreview.previewBody")}
              <div className="mt-4">
                <Button onClick={handleDownloadPdf} className="w-full">
                  {t("documents.custom.invoicePreview.downloadPdf")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>

          <dl className="space-y-3 py-2">
            {descriptor.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-0.5 border-b pb-2 last:border-0">
                <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                <dd className="text-sm">
                  <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}

registerDocumentCustomComponent("invoice", "list-row-extra", InvoicePreviewButton)

export { InvoicePreviewButton }

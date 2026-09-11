"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { format } from "date-fns"

import { DatePicker } from "@/components/date-picker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { authenticatedFetch } from "@/hooks/use-fetch"

/**
 * TODO_FEATURES.md rank 4 — the GENERIC accounting CSV export's own download UI (the CSV slice only;
 * a per-country ledger FORMAT is a future extension, see the backend's own
 * accounting-export.service.ts header). `GET /api/accounting-export?from=...&to=...` is hit directly
 * through `authenticatedFetch`, never a plain `<a href>`: the endpoint needs the session cookie, which
 * a bare anchor navigation to a DIFFERENT origin (`VITE_BACKEND_URL`) would not carry — the same
 * cross-port/cookie reasoning `received-invoice-download-button.tsx`'s own header already gives for
 * its PDF download. Unlike that button, this triggers an actual named "Save As" (a blob object URL fed
 * to a synthetic `<a download>`, then revoked) rather than `window.open`: a CSV has no useful "view
 * inline", so this is the SERVER-fed twin of `hooks/use-table-export.ts`'s own client-built download.
 */
export default function AccountingExportSettings() {
  const { t } = useTranslation()
  const [from, setFrom] = useState<Date | null>(null)
  const [to, setTo] = useState<Date | null>(null)
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (!from || !to) {
      toast.error(t("settings.accountingExport.messages.rangeRequired"))
      return
    }
    if (from > to) {
      toast.error(t("settings.accountingExport.messages.invalidRange"))
      return
    }

    // YYYY-MM-DD — exactly what the backend's own `from`/`to` query params expect (see
    // accounting-export.controller.ts): a calendar day, never an instant.
    const fromParam = format(from, "yyyy-MM-dd")
    const toParam = format(to, "yyyy-MM-dd")

    setDownloading(true)
    try {
      const response = await authenticatedFetch(`/api/accounting-export?from=${fromParam}&to=${toParam}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `accounting-export-${fromParam}_${toParam}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.accountingExport.messages.error"))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card data-cy="accounting-export-card">
      <CardHeader>
        <CardTitle>{t("settings.accountingExport.title")}</CardTitle>
        <CardDescription>{t("settings.accountingExport.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("settings.accountingExport.form.from")}</span>
            <DatePicker value={from} onChange={setFrom} data-cy="accounting-export-from" />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("settings.accountingExport.form.to")}</span>
            <DatePicker value={to} onChange={setTo} data-cy="accounting-export-to" />
          </div>
          <Button
            type="button"
            onClick={() => void handleDownload()}
            loading={downloading}
            data-cy="accounting-export-download"
          >
            {t("settings.accountingExport.form.download")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

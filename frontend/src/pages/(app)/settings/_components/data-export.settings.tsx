"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCompanies } from "@/hooks/queries"
import { authenticatedFetch } from "@/hooks/use-fetch"

import { SettingsFormFooter, SettingsSection } from "./settings-section"

/**
 * Self-service full data export (`POST /api/companies/export`) — the same archive the hosted-billing
 * lifecycle sweep already mails an OWNER automatically once a subscription is blocked, available on
 * demand instead of waiting for that or writing to support. A self-contained action, deliberately NOT
 * wired into the surrounding company settings `<form>` (company.settings.tsx, which renders this
 * section) — the same separation `currency-rates.settings.tsx` already draws for its own resource.
 *
 * The backend picks how the export reaches the caller: a small one comes back as the response body
 * itself (streamed straight into a "Save As", the same blob-URL pattern
 * `accounting-export.settings.tsx` already uses for its CSV), a large one is emailed instead (202,
 * never a body worth downloading here) — this only has to branch on the STATUS CODE, never guess
 * which happened from the byte count itself. A 429 names the rate limit in plain text; that message
 * is shown verbatim rather than a generic "export failed".
 */
export default function DataExportSettings() {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const canExport = activeRole === "OWNER" || activeRole === "ADMIN"
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const response = await authenticatedFetch("/api/companies/export", { method: "POST" })

      if (response.status === 202) {
        const body = await response.json().catch(() => null)
        toast.success(body?.message || t("settings.dataExport.messages.emailed"))
        return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message || `HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "invoicerr-export.zip"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success(t("settings.dataExport.messages.downloaded"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.dataExport.messages.error"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <SettingsSection
      dataCy="data-export-card"
      title={t("settings.dataExport.title")}
      description={t("settings.dataExport.description")}
      footer={
        canExport ? (
          <SettingsFormFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleExport()}
              loading={exporting}
              data-cy="data-export-button"
            >
              {t("settings.dataExport.form.export")}
            </Button>
          </SettingsFormFooter>
        ) : undefined
      }
    >
      {canExport ? (
        <p className="text-sm text-muted-foreground">{t("settings.dataExport.form.hint")}</p>
      ) : (
        <p className="text-sm text-muted-foreground" data-cy="data-export-member-notice">
          {t("settings.dataExport.messages.memberNotice")}
        </p>
      )}
    </SettingsSection>
  )
}

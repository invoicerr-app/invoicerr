"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Wallet } from "lucide-react"

import { decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { authenticatedFetch, useGet } from "@/hooks/use-fetch"
import type { CashedRevenueReport } from "@/types"

import { SettingsList, SettingsListRow, SettingsPage, SettingsSection } from "./settings-section"

/** The company's own default ("" - resolved server-side from `Company.revenuePeriod`, see
 *  `resolve-revenue-basis.ts`), or an explicit override for THIS screen only - never written back to
 *  the company setting (that happens on the Company tab's own "Revenue basis" section). */
const USE_COMPANY_DEFAULT = "__default__"

function formatAmount(totalMinor: number, currency: string): string {
  return `${fromMinor(totalMinor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

/**
 * Issue #516's "cashed-revenue view per period" - money actually received against sent invoices,
 * bucketed by month or quarter, converted into the reference currency (when one is set) at each
 * PAYMENT's own frozen rate (`GET /api/revenue/cashed`, `revenue-report.service.ts`). Explicitly
 * labelled an AID, never the official declaration - see `report.disclaimer`, echoed verbatim here AND
 * as a comment line in the CSV itself so the label survives a download.
 *
 * CSV downloaded the same way `accounting-export.settings.tsx` already does: `authenticatedFetch`
 * (carries the session cookie across the backend's own origin) into a blob, never a bare `<a href>`.
 */
export default function CashedRevenueSettings() {
  const { t } = useTranslation()
  const [granularity, setGranularity] = useState<string>(USE_COMPANY_DEFAULT)
  const [downloading, setDownloading] = useState(false)

  const query = granularity === USE_COMPANY_DEFAULT ? "" : `?granularity=${granularity}`
  const { data: report, loading } = useGet<CashedRevenueReport>(`/api/revenue/cashed${query}`)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const response = await authenticatedFetch(`/api/revenue/cashed/export${query}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `cashed-revenue-${report?.granularity ?? "export"}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.cashedRevenue.messages.exportError"))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <SettingsPage
      title={t("settings.cashedRevenue.title")}
      description={t("settings.cashedRevenue.description")}
      dataCy="cashed-revenue-section"
    >
      <SettingsSection dataCy="cashed-revenue-controls-card" contentClassName="grid gap-4">
        <Alert variant="warning" data-cy="cashed-revenue-disclaimer">
          <AlertDescription>
            {report?.disclaimer ?? t("settings.cashedRevenue.disclaimerFallback")}
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("settings.cashedRevenue.form.granularity")}</span>
            <Select value={granularity} onValueChange={setGranularity}>
              <SelectTrigger data-cy="cashed-revenue-granularity-select" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USE_COMPANY_DEFAULT} data-cy="cashed-revenue-granularity-option-default">
                  {t("settings.cashedRevenue.form.granularityDefault")}
                </SelectItem>
                <SelectItem value="monthly" data-cy="cashed-revenue-granularity-option-monthly">
                  {t("settings.company.form.revenuePeriod.options.monthly", "Monthly")}
                </SelectItem>
                <SelectItem value="quarterly" data-cy="cashed-revenue-granularity-option-quarterly">
                  {t("settings.company.form.revenuePeriod.options.quarterly", "Quarterly")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={() => void handleDownload()}
            loading={downloading}
            disabled={!report}
            data-cy="cashed-revenue-export-btn"
          >
            {t("settings.cashedRevenue.form.export")}
          </Button>
        </div>

        {report && (
          <p className="text-xs text-muted-foreground" data-cy="cashed-revenue-basis-note">
            {t("settings.cashedRevenue.basisNote", {
              basis: t(`settings.company.form.revenueBasis.options.${report.basis}`),
              granularity: t(`settings.company.form.revenuePeriod.options.${report.granularity}`),
            })}
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings.cashedRevenue.periods.title")}
        dataCy="cashed-revenue-periods-card"
        contentClassName="grid gap-4"
      >
        {!report && loading && (
          <p className="text-sm text-muted-foreground" data-cy="cashed-revenue-loading">
            {t("settings.cashedRevenue.loading")}
          </p>
        )}

        {report && report.periods.length === 0 && (
          <EmptyState
            size="sm"
            icon={Wallet}
            title={t("settings.cashedRevenue.empty")}
            data-cy="cashed-revenue-empty"
          />
        )}

        {report && report.periods.length > 0 && (
          <SettingsList dataCy="cashed-revenue-periods-table">
            {report.periods.map((period) => {
              const nothingCashed = period.byCurrency.length === 0
              return (
                <SettingsListRow
                  key={period.key}
                  dataCy={`cashed-revenue-period-${period.key}`}
                  title={<span data-cy={`cashed-revenue-period-${period.key}-label`}>{period.label}</span>}
                  meta={
                    nothingCashed ? (
                      <span data-cy={`cashed-revenue-period-${period.key}-zero`}>
                        {t("settings.cashedRevenue.periods.zero")}
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {period.byCurrency.map((amount) => (
                          <span
                            key={amount.currency}
                            className="font-mono tabular-nums"
                            data-cy={`cashed-revenue-period-${period.key}-amount-${amount.currency}`}
                          >
                            {formatAmount(amount.totalMinor, amount.currency)}
                          </span>
                        ))}
                      </span>
                    )
                  }
                  primary={
                    period.consolidated ? (
                      <span
                        className="font-mono tabular-nums text-sm"
                        title={period.consolidated.notes.join(" ")}
                        data-cy={`cashed-revenue-period-${period.key}-consolidated`}
                      >
                        ≈ {formatAmount(period.consolidated.totalMinor, period.consolidated.currency)}
                      </span>
                    ) : period.warnings.length > 0 ? (
                      <Badge
                        variant="warning"
                        data-cy={`cashed-revenue-period-${period.key}-warning`}
                        title={period.warnings.join(" ")}
                      >
                        {t("settings.cashedRevenue.periods.rateMissing")}
                      </Badge>
                    ) : undefined
                  }
                />
              )
            })}
          </SettingsList>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}

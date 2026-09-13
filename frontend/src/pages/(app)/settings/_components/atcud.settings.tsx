"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useGet, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react"

interface CompanyInfo {
  country?: string
  countryCode?: string | null
  numberFormats?: Record<string, string> | null
}

interface AtcudSeriesRow {
  id: string
  typeId: string
  seriesId: string
  validationCode: string
  createdAt: string
  updatedAt: string
}

/** Same case-insensitive "PT"/"Portugal" check the rest of this screen's own gating relies on — a UX
 *  convenience only, never the enforcement: `documents/actions/atcud-issuance.ts#ensureAtcudIssuable`
 *  is the one place that ACTUALLY decides whether an invoice can be issued, from the company's real,
 *  server-resolved country (`country-policy/country-policy.ts#resolveCompanyCountryCode`). A company
 *  reaching this screen with a country this quick check cannot recognize simply sees the same "not
 *  applicable" message a French or German company would — never a hard error. */
function isPortugal(company: CompanyInfo | null): boolean {
  if (!company) return false
  const value = (company.countryCode || company.country || "").trim().toUpperCase()
  return value === "PT" || value === "PORTUGAL"
}

/**
 * Soft, client-side mirror of `documents/numbering/atcud.ts#parseAtcudPattern`'s trailing-token check
 * — a live hint only, shown next to the input as the user types. The backend re-validates in full
 * (including the "no second {number} token in the series" rule this simplified check does not
 * reproduce) the moment an invoice is actually sent; this never blocks the SAVE button, it only warns.
 */
function looksAtcudCompatible(pattern: string): boolean {
  return /\/(\{number(?::\d+)?\})$/.test(pattern.trim())
}

/** This product's own shipped default when a company has never set one — `numbering/
 *  format-number.ts#defaultNumberFormatFor('invoice')` — never expressible with a literal "{type}"
 *  token from this screen (that substitution happens server-side, once, before storage), so this is
 *  spelled out verbatim purely as a REFERENCE for the placeholder/empty-state text below. */
const SHIPPED_DEFAULT_INVOICE_FORMAT = "INVOICE-{year}-{number:4}"

function NumberFormatCard({ company, onSaved }: { company: CompanyInfo; onSaved: () => void }) {
  const { t } = useTranslation()
  const currentPattern = company.numberFormats?.invoice ?? SHIPPED_DEFAULT_INVOICE_FORMAT
  const [pattern, setPattern] = useState(currentPattern)

  useEffect(() => setPattern(currentPattern), [currentPattern])

  const { trigger: save, loading: saving } = useMutationWithToast(
    usePut("/api/company/number-format"),
    t("settings.atcud.numberFormat.messages.saveError", "Failed to save the number format"),
  )

  const compatible = looksAtcudCompatible(pattern)

  const handleSave = async () => {
    const result = await save({ typeId: "invoice", pattern })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.atcud.numberFormat.messages.saveSuccess", "Invoice number format saved"))
    onSaved()
  }

  return (
    <Card data-cy="atcud-number-format-card">
      <CardHeader>
        <CardTitle className="text-base">
          {t("settings.atcud.numberFormat.title", "Invoice number format")}
        </CardTitle>
        <CardDescription>
          {t(
            "settings.atcud.numberFormat.description",
            'The ATCUD sequential number is, by law, "the digits immediately after the / " in your ' +
              "invoice number (Portaria n.º 195/2020, art. 3.º n.º 3). Your format must therefore end " +
              'in a literal "/" immediately followed by "{number}" (or "{number:N}"), e.g. ' +
              '"FT {year}/{number:4}".',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="atcud-invoice-number-format">
              {t("settings.atcud.numberFormat.label", "Invoice number format")}
            </Label>
            <Input
              id="atcud-invoice-number-format"
              data-cy="atcud-number-format-input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="FT {year}/{number:4}"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || pattern.trim().length === 0}
            data-cy="atcud-number-format-save-button"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("settings.atcud.numberFormat.save", "Save")}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm" data-cy="atcud-number-format-status">
          {compatible ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {t(
                  "settings.atcud.numberFormat.compatible",
                  "Compatible with the ATCUD sequential-number rule",
                )}
              </span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-muted-foreground">
                {t(
                  "settings.atcud.numberFormat.incompatible",
                  'Not compatible yet — it must end in "/" immediately followed by "{number}" or "{number:N}"',
                )}
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SeriesRow({ series, onDeleted }: { series: AtcudSeriesRow; onDeleted: () => void }) {
  const { t } = useTranslation()
  const { trigger: remove, loading: removing } = useMutationWithToast(
    useDelete(`/api/company/atcud-series/${series.id}`),
    t("settings.atcud.series.messages.deleteError", "Failed to remove this series"),
  )

  const handleDelete = async () => {
    const result = await remove()
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.atcud.series.messages.deleteSuccess", "Series removed"))
    onDeleted()
  }

  return (
    <Card data-cy={`atcud-series-row-${series.id}`}>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium" data-cy={`atcud-series-row-${series.id}-seriesId`}>
              {series.seriesId}
            </p>
            <Badge variant="outline">{series.typeId}</Badge>
          </div>
          <p
            className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
            data-cy={`atcud-series-row-${series.id}-code`}
          >
            {series.validationCode}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive"
          disabled={removing}
          onClick={handleDelete}
          data-cy={`atcud-series-row-${series.id}-delete-button`}
        >
          {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Company settings → ATCUD (Portugal only). Lets a Portuguese company record, per series, the
 * "código de validação" it obtained from the Portal das Finanças (AT FAQ 4308/4312) — WITHOUT this,
 * `documents/actions/atcud-issuance.ts#ensureAtcudIssuable` refuses to send any invoice in that
 * series, by design (see that file's own header): a missing ATCUD is refused loudly, never invented.
 *
 * `GET/PUT/DELETE /api/company/atcud-series` (`modules/company/atcud-series/`) — the validation code
 * is NOT a secret (it is printed on every invoice), so unlike `signing-certificates.settings.tsx` this
 * screen shows it in full and lets it be edited freely, no write-only field.
 */
export default function AtcudSettings() {
  const { t } = useTranslation()
  const { data: company, mutate: refetchCompany } = useGet<CompanyInfo>("/api/company/info")
  const { data: seriesList, mutate: refetchSeries } = useGet<AtcudSeriesRow[]>("/api/company/atcud-series")
  const series = seriesList ?? []

  const [seriesId, setSeriesId] = useState("")
  const [validationCode, setValidationCode] = useState("")

  const { trigger: upsert, loading: saving } = useMutationWithToast(
    usePut("/api/company/atcud-series"),
    t("settings.atcud.series.messages.saveError", "Failed to save the series"),
  )

  const resetForm = () => {
    setSeriesId("")
    setValidationCode("")
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await upsert({ typeId: "invoice", seriesId, validationCode })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.atcud.series.messages.saveSuccess", "Series saved"))
    resetForm()
    refetchSeries()
  }

  if (!isPortugal(company ?? null)) {
    return (
      <div className="space-y-6" data-cy="atcud-section">
        <div>
          <h1 className="text-2xl font-bold mb-2">{t("settings.atcud.title", "ATCUD (Portugal)")}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-cy="atcud-not-applicable">
            {t(
              "settings.atcud.notApplicable",
              "The ATCUD is a Portuguese legal requirement — this section only applies to a company registered in Portugal.",
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-cy="atcud-section">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.atcud.title", "ATCUD (Portugal)")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.atcud.description",
            "Portaria n.º 195/2020 requires every Portuguese invoice to carry an ATCUD, obtained per " +
              "series from the AT (Portal das Finanças), BEFORE any document in that series is issued.",
          )}
        </p>
      </div>

      <NumberFormatCard company={company as CompanyInfo} onSaved={refetchCompany} />

      <Card data-cy="atcud-series-add-card">
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.atcud.series.addTitle", "Register a series validation code")}
          </CardTitle>
          <CardDescription>
            {t(
              "settings.atcud.series.addDescription",
              'The series identifier is the part of your invoice number BEFORE the "/" — e.g. "FT ' +
                '2026" for the format "FT {year}/{number:4}".',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="atcud-series-id">
                  {t("settings.atcud.series.seriesId", "Series identifier")}
                </Label>
                <Input
                  id="atcud-series-id"
                  data-cy="atcud-series-id-input"
                  required
                  placeholder="FT 2026"
                  value={seriesId}
                  onChange={(e) => setSeriesId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="atcud-validation-code">
                  {t("settings.atcud.series.validationCode", "AT validation code")}
                </Label>
                <Input
                  id="atcud-validation-code"
                  data-cy="atcud-validation-code-input"
                  required
                  minLength={8}
                  placeholder="JCVPTS0J"
                  value={validationCode}
                  onChange={(e) => setValidationCode(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving} data-cy="atcud-series-save-button">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("settings.atcud.series.save", "Save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3" data-cy="atcud-series-list">
        {series.length > 0 ? (
          series.map((row) => <SeriesRow key={row.id} series={row} onDeleted={refetchSeries} />)
        ) : (
          <Card>
            <CardContent
              className="flex flex-col items-center justify-center py-10"
              data-cy="atcud-series-empty-state"
            >
              <p className="text-center text-muted-foreground">
                {t(
                  "settings.atcud.series.emptyState",
                  "No ATCUD series registered yet — invoices cannot be sent until at least one is.",
                )}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

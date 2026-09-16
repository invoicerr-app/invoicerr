"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useGet, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { Check, Hash, Info, Trash2, XCircle } from "lucide-react"

import {
  SettingsFormFooter,
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
  useSavedFlash,
} from "./settings-section"

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
  const [saved, flash] = useSavedFlash()

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
    flash()
  }

  return (
    <SettingsSection
      title={t("settings.atcud.numberFormat.title", "Invoice number format")}
      description={t(
        "settings.atcud.numberFormat.description",
        'The ATCUD sequential number is, by law, "the digits immediately after the / " in your ' +
          "invoice number (Portaria n.º 195/2020, art. 3.º n.º 3). Your format must therefore end " +
          'in a literal "/" immediately followed by "{number}" (or "{number:N}"), e.g. ' +
          '"FT {year}/{number:4}".',
      )}
      dataCy="atcud-number-format-card"
      footer={
        <SettingsFormFooter saved={saved}>
          <Button
            onClick={handleSave}
            disabled={pattern.trim().length === 0}
            loading={saving}
            data-cy="atcud-number-format-save-button"
          >
            {t("settings.atcud.numberFormat.save", "Save")}
          </Button>
        </SettingsFormFooter>
      }
    >
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="atcud-invoice-number-format">
          {t("settings.atcud.numberFormat.label", "Invoice number format")}
        </Label>
        <Input
          id="atcud-invoice-number-format"
          data-cy="atcud-number-format-input"
          className="font-mono"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="FT {year}/{number:4}"
        />
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-cy="atcud-number-format-status"
        >
          {compatible ? (
            <>
              <Check className="size-3.5 text-success-foreground" aria-hidden="true" />
              {t(
                "settings.atcud.numberFormat.compatible",
                "Compatible with the ATCUD sequential-number rule",
              )}
            </>
          ) : (
            <>
              <XCircle className="size-3.5 text-destructive" aria-hidden="true" />
              {t(
                "settings.atcud.numberFormat.incompatible",
                'Not compatible yet — it must end in "/" immediately followed by "{number}" or "{number:N}"',
              )}
            </>
          )}
        </p>
      </div>
    </SettingsSection>
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
    <SettingsListRow
      dataCy={`atcud-series-row-${series.id}`}
      badge={<Badge variant="outline">{series.typeId}</Badge>}
      title={<span data-cy={`atcud-series-row-${series.id}-seriesId`}>{series.seriesId}</span>}
      meta={
        <span className="font-mono tabular-nums" data-cy={`atcud-series-row-${series.id}-code`}>
          {series.validationCode}
        </span>
      }
      primary={
        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          loading={removing}
          data-cy={`atcud-series-row-${series.id}-delete-button`}
        >
          {!removing && <Trash2 aria-hidden="true" />}
          {t("settings.common.delete", "Delete")}
        </Button>
      }
    />
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
  const [addSaved, flashAdd] = useSavedFlash()

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
    flashAdd()
  }

  if (!isPortugal(company ?? null)) {
    return (
      <SettingsPage title={t("settings.atcud.title", "ATCUD (Portugal)")} dataCy="atcud-section">
        <SettingsSection>
          <EmptyState
            icon={Info}
            size="sm"
            title={t(
              "settings.atcud.notApplicable",
              "The ATCUD is a Portuguese legal requirement — this section only applies to a company registered in Portugal.",
            )}
            data-cy="atcud-not-applicable"
          />
        </SettingsSection>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title={t("settings.atcud.title", "ATCUD (Portugal)")}
      description={t(
        "settings.atcud.description",
        "Portaria n.º 195/2020 requires every Portuguese invoice to carry an ATCUD, obtained per " +
          "series from the AT (Portal das Finanças), BEFORE any document in that series is issued.",
      )}
      dataCy="atcud-section"
    >
      <NumberFormatCard company={company as CompanyInfo} onSaved={refetchCompany} />

      <SettingsSection
        title={t("settings.atcud.series.addTitle", "Register a series validation code")}
        description={t(
          "settings.atcud.series.addDescription",
          'The series identifier is the part of your invoice number BEFORE the "/" — e.g. "FT ' +
            '2026" for the format "FT {year}/{number:4}".',
        )}
        dataCy="atcud-series-add-card"
        footer={
          <SettingsFormFooter saved={addSaved}>
            {/* `secondary`, not the tab's own default: the number-format save above is the ONE
             *  primary this screen has — registering a series is a repeatable "add an item" action,
             *  the same weight `currency-rates.settings.tsx`'s own "Add rate" carries next to
             *  `company.settings.tsx`'s primary. */}
            <Button
              type="submit"
              variant="secondary"
              form="atcud-series-add-form"
              loading={saving}
              data-cy="atcud-series-save-button"
            >
              {t("settings.atcud.series.save", "Save")}
            </Button>
          </SettingsFormFooter>
        }
      >
        <form id="atcud-series-add-form" onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-2">
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
              className="font-mono"
              placeholder="JCVPTS0J"
              value={validationCode}
              onChange={(e) => setValidationCode(e.target.value)}
            />
          </div>
        </form>
      </SettingsSection>

      <div data-cy="atcud-series-list">
        {series.length > 0 ? (
          <SettingsList>
            {series.map((row) => (
              <SeriesRow key={row.id} series={row} onDeleted={refetchSeries} />
            ))}
          </SettingsList>
        ) : (
          <SettingsSection>
            <EmptyState
              icon={Hash}
              size="sm"
              title={t(
                "settings.atcud.series.emptyState",
                "No ATCUD series registered yet — invoices cannot be sent until at least one is.",
              )}
              data-cy="atcud-series-empty-state"
            />
          </SettingsSection>
        )}
      </div>
    </SettingsPage>
  )
}

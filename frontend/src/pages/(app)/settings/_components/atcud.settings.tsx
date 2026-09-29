"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useGet, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import type { CompanyNumberFormats } from "@/types"
import { Hash, Info, Trash2 } from "lucide-react"

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
 * The document types that carry an ATCUD (issue #497), each with its SAF-T (PT) document type: the
 * type a series is registered under on the Portal das Finanças (Portaria n.º 195/2020, art. 2.º b)).
 * Mirrors `documents/numbering/atcud.ts#SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID`, the backend table that
 * actually decides; this copy only labels the screen.
 */
const ATCUD_DOCUMENT_TYPES = [
  { typeId: "invoice", saftType: "FT" },
  { typeId: "credit-note", saftType: "NC" },
] as const

type AtcudTypeId = (typeof ATCUD_DOCUMENT_TYPES)[number]["typeId"]

function useAtcudTypeLabel() {
  const { t } = useTranslation()
  return (typeId: string) => {
    if (typeId === "credit-note") return t("settings.atcud.types.creditNote", "Credit note (NC)")
    if (typeId === "invoice") return t("settings.atcud.types.invoice", "Invoice (FT)")
    return typeId
  }
}

/** The series a number belongs to, as the AT sees it in this product: everything before the LAST "/"
 *  (`numbering/atcud.ts#splitAtcudDisplayNumber`'s own split). Read off the next number the backend
 *  would print, never re-rendered here from the pattern. */
function seriesOf(displayNumber: string): string | null {
  const slash = displayNumber.lastIndexOf("/")
  return slash > 0 ? displayNumber.slice(0, slash) : null
}

/** The invoice card keeps the `data-cy` prefix it always had; the credit note card (issue #497) its
 *  own. */
function numberFormatCopy(typeId: AtcudTypeId, t: ReturnType<typeof useTranslation>["t"]) {
  if (typeId === "credit-note") {
    return {
      dataCyPrefix: "atcud-credit-note-number-format",
      title: t("settings.atcud.creditNoteNumberFormat.title"),
      description: t("settings.atcud.creditNoteNumberFormat.description"),
    }
  }
  return {
    dataCyPrefix: "atcud-number-format",
    title: t("settings.atcud.numberFormat.title"),
    description: t("settings.atcud.numberFormat.description"),
  }
}

/**
 * Issue #496 - one ATCUD type's number format, READ-ONLY. It is Portugal's own ("FT A/{number}" for an
 * invoice, "NC A/{number}" for a credit note, `country-policy/data/pt.json`), or a series this company
 * already started and keeps; either way it is no longer the company's to change (`PUT
 * /api/company/number-format` answers 405). What this card still gives is the one fact the
 * registration form below needs: the series the next document of this type belongs to, whose AT
 * validation code must be registered before that document is issued.
 */
function NumberFormatCard({
  typeId,
  formats,
}: {
  typeId: AtcudTypeId
  formats?: CompanyNumberFormats | null
}) {
  const { t } = useTranslation()
  const copy = numberFormatCopy(typeId, t)
  const format = formats?.formats.find((f) => f.typeId === typeId)
  const series = format ? seriesOf(format.nextDisplayNumber) : null

  return (
    <SettingsSection title={copy.title} description={copy.description} dataCy={`${copy.dataCyPrefix}-card`}>
      {format && (
        <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
          <dt className="text-muted-foreground">{t("settings.atcud.numberFormat.label")}</dt>
          <dd>
            <code className="font-mono" data-cy={`${copy.dataCyPrefix}-pattern`}>
              {format.pattern}
            </code>
          </dd>
          <dt className="text-muted-foreground">{t("settings.atcud.numberFormat.next")}</dt>
          <dd className="font-mono">{format.nextDisplayNumber}</dd>
          <dt className="text-muted-foreground">{t("settings.atcud.numberFormat.series")}</dt>
          <dd>
            <span className="font-mono font-medium" data-cy={`${copy.dataCyPrefix}-series`}>
              {series}
            </span>
          </dd>
        </dl>
      )}
    </SettingsSection>
  )
}

function SeriesRow({ series, onDeleted }: { series: AtcudSeriesRow; onDeleted: () => void }) {
  const { t } = useTranslation()
  const typeLabel = useAtcudTypeLabel()
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
      badge={
        <Badge variant="outline" data-cy={`atcud-series-row-${series.id}-type`}>
          {typeLabel(series.typeId)}
        </Badge>
      }
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
 * `documents/actions/atcud-issuance.ts#ensureAtcudIssuable` refuses to send any invoice or credit
 * note (issue #497) in that series, by design (see that file's own header): a missing ATCUD is refused loudly, never invented.
 *
 * `GET/PUT/DELETE /api/company/atcud-series` (`modules/company/atcud-series/`) — the validation code
 * is NOT a secret (it is printed on every invoice), so unlike `signing-certificates.settings.tsx` this
 * screen shows it in full and lets it be edited freely, no write-only field.
 */
export default function AtcudSettings() {
  const { t } = useTranslation()
  const { data: company } = useGet<CompanyInfo>("/api/company/info")
  const { data: numberFormats } = useGet<CompanyNumberFormats>("/api/company/number-formats")
  const { data: seriesList, mutate: refetchSeries } = useGet<AtcudSeriesRow[]>("/api/company/atcud-series")
  const series = seriesList ?? []
  const [addSaved, flashAdd] = useSavedFlash()

  const typeLabel = useAtcudTypeLabel()
  const [seriesTypeId, setSeriesTypeId] = useState<AtcudTypeId>("invoice")
  const [seriesId, setSeriesId] = useState("")
  const [validationCode, setValidationCode] = useState("")
  const seriesSaftType = ATCUD_DOCUMENT_TYPES.find((type) => type.typeId === seriesTypeId)?.saftType ?? "FT"

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
    const result = await upsert({ typeId: seriesTypeId, seriesId, validationCode })
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
        "settings.atcud.descriptionDocuments",
        "Portaria n.º 195/2020 requires every Portuguese invoice and credit note to carry an ATCUD, " +
          "obtained per series from the AT (Portal das Finanças), BEFORE any document in that series is issued.",
      )}
      dataCy="atcud-section"
    >
      {ATCUD_DOCUMENT_TYPES.map((type) => (
        <NumberFormatCard key={type.typeId} typeId={type.typeId} formats={numberFormats} />
      ))}

      <SettingsSection
        title={t("settings.atcud.series.addTitle", "Register a series validation code")}
        description={t(
          "settings.atcud.series.addDescriptionTyped",
          "The AT issues one code per series and document type: register invoice (FT) and credit note " +
            '(NC) series separately. The series identifier is the part of the number BEFORE the "/", ' +
            'e.g. "NC A" for credit notes numbered "NC A/{number}".',
        )}
        dataCy="atcud-series-add-card"
        footer={
          <SettingsFormFooter saved={addSaved}>
            {/* `secondary`: registering a series is a repeatable "add an item" action, the same
             *  weight `currency-rates.settings.tsx`'s own "Add rate" carries next to
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
        <form id="atcud-series-add-form" onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="atcud-series-type">
              {t("settings.atcud.series.documentType", "Document type")}
            </Label>
            <Select value={seriesTypeId} onValueChange={(value) => setSeriesTypeId(value as AtcudTypeId)}>
              <SelectTrigger id="atcud-series-type" className="w-full" dataCy="atcud-series-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATCUD_DOCUMENT_TYPES.map((type) => (
                  <SelectItem
                    key={type.typeId}
                    value={type.typeId}
                    dataCy={`atcud-series-type-option-${type.typeId}`}
                  >
                    {typeLabel(type.typeId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="atcud-series-id">
              {t("settings.atcud.series.seriesId", "Series identifier")}
            </Label>
            <Input
              id="atcud-series-id"
              data-cy="atcud-series-id-input"
              required
              placeholder={`${seriesSaftType} A`}
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
                "settings.atcud.series.emptyStateDocuments",
                "No ATCUD series registered yet. Invoices and credit notes cannot be sent until their series is.",
              )}
              data-cy="atcud-series-empty-state"
            />
          </SettingsSection>
        )}
      </div>
    </SettingsPage>
  )
}

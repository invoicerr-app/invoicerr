import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useGet } from "@/hooks/use-fetch"
import type { CompanyNumberFormat, CompanyNumberFormats } from "@/types"

import { SettingsSection } from "./settings-section"

/**
 * Issue #496 - the document number formats, READ-ONLY. A number format is defined per country and
 * document type from the rules that constrain it (law, e-invoicing formats, clearance platforms), in
 * the backend's `documents/country-policy/data/xx.json`; a company can no longer change it, and
 * `PUT /api/company/number-format` answers 405. This card shows, per numbered type, the pattern that
 * applies, the next number it will print (read from the real counter), where it comes from, and every
 * rule behind it with its source. The rule summaries are plain English DATA from the catalog, shown
 * verbatim, the same convention the country-policy refusal messages already follow.
 */
export function NumberFormatsSection() {
  const { t, i18n } = useTranslation()
  const { data } = useGet<CompanyNumberFormats>("/api/company/number-formats")

  const typeLabel: Record<string, string> = {
    quote: t("settings.company.numberFormats.types.quote"),
    invoice: t("settings.company.numberFormats.types.invoice"),
    "credit-note": t("settings.company.numberFormats.types.creditNote"),
    "purchase-order": t("settings.company.numberFormats.types.purchaseOrder"),
    "goods-receipt": t("settings.company.numberFormats.types.goodsReceipt"),
  }

  const countryName = (code: string | null) => {
    if (!code) return ""
    try {
      return new Intl.DisplayNames([i18n.language || "en"], { type: "region" }).of(code) ?? code
    } catch {
      return code
    }
  }

  return (
    <SettingsSection
      title={t("settings.company.numberFormats.title")}
      description={t("settings.company.numberFormats.description")}
      dataCy="number-formats-section"
      contentClassName="grid gap-4"
    >
      {!data ? null : data.formats.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-cy="number-formats-unavailable">
          {data.unavailableReason}
        </p>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-lg border" data-cy="number-formats-list">
            {data.formats.map((format) => (
              <NumberFormatRow
                key={format.typeId}
                format={format}
                label={typeLabel[format.typeId] ?? format.typeId}
                country={countryName(data.countryCode)}
              />
            ))}
          </ul>
          {data.runningSeries && (
            <p className="text-xs text-muted-foreground text-pretty" data-cy="number-formats-running-series">
              <span className="font-medium text-foreground">
                {t("settings.company.numberFormats.runningSeriesTitle")}
              </span>{" "}
              {data.runningSeries.summary}
            </p>
          )}
        </>
      )}
    </SettingsSection>
  )
}

function NumberFormatRow({
  format,
  label,
  country,
}: {
  format: CompanyNumberFormat
  label: string
  country: string
}) {
  const { t } = useTranslation()

  return (
    <li className="grid gap-2 px-4 py-3" data-cy={`number-format-${format.typeId}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <code
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
            data-cy="number-format-pattern"
          >
            {format.pattern}
          </code>
          <Badge
            variant={format.source === "running-series" ? "info" : "secondary"}
            data-cy="number-format-source"
          >
            {format.source === "running-series"
              ? t("settings.company.numberFormats.source.runningSeries")
              : t("settings.company.numberFormats.source.country", { country })}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground" data-cy="number-format-next">
          {t("settings.company.numberFormats.next")}{" "}
          <span className="font-mono text-foreground">{format.nextDisplayNumber}</span>
        </span>
      </div>

      {format.supersededRunningSeries && (
        <p className="text-xs text-warning-foreground text-pretty" data-cy="number-format-superseded">
          {t("settings.company.numberFormats.superseded", {
            pattern: format.supersededRunningSeries.pattern,
            reasons: format.supersededRunningSeries.violations.map((v) => v.message).join("; "),
          })}
        </p>
      )}

      {format.constraints.length > 0 ? (
        <ul className="grid gap-1.5">
          {format.constraints.map((constraint) => (
            <li
              key={constraint.id}
              className="text-xs text-muted-foreground text-pretty"
              data-cy={`number-format-constraint-${constraint.id}`}
            >
              <span className="text-foreground">{constraint.summary}</span>{" "}
              <span className="whitespace-nowrap">
                (
                {constraint.provenance.kind === "legal"
                  ? t("settings.company.numberFormats.provenance.legal", {
                      date: constraint.provenance.sourceCheckedAt,
                    })
                  : t("settings.company.numberFormats.provenance.unverified")}
                )
              </span>
            </li>
          ))}
        </ul>
      ) : (
        format.unconstrained && (
          <p className="text-xs text-muted-foreground text-pretty" data-cy="number-format-unconstrained">
            {format.unconstrained}
          </p>
        )
      )}
    </li>
  )
}

import { Download, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import SearchSelect from "@/components/search-input"
import type React from "react"
import { useTranslation } from "react-i18next"

const ALL = "__all__"

interface TableSearchFilterProps {
  label: string
  options: { label: string; value: string }[]
  value?: string
  onValueChange: (value?: string) => void
  onSearchChange: (term: string) => void
  placeholder: string
  noResultsText: string
  dataCy: string
}

/**
 * Searchable entity filter (client, invoice, ...) with a clear button,
 * shared by the invoice/quote/payment tables.
 */
export function TableSearchFilter({
  label,
  options,
  value,
  onValueChange,
  onSearchChange,
  placeholder,
  noResultsText,
  dataCy,
}: TableSearchFilterProps) {
  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-1">
        <SearchSelect
          options={options}
          value={value ?? ""}
          onValueChange={(val) => onValueChange((val as string) || undefined)}
          onSearchChange={onSearchChange}
          placeholder={placeholder}
          noResultsText={noResultsText}
          data-cy={dataCy}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onValueChange(undefined)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

interface TableFilterBarProps {
  /** i18n namespace: `${prefix}.table.filters.*` / `${prefix}.table.actions.export`. */
  translationPrefix: "invoices" | "quotes" | "payments"
  year?: number
  onYearChange: (year?: number) => void
  month?: number
  onMonthChange: (month?: number) => void
  onExport: () => void
  exportDisabled: boolean
  /** Search filters (client select, payments' invoice select) rendered before the year filter. */
  children?: React.ReactNode
}

/**
 * Filter row shared by the invoice/quote/payment tables: entity search
 * filters (slot), year + dependent month selects, and the CSV export button.
 */
export function TableFilterBar({
  translationPrefix,
  year,
  onYearChange,
  month,
  onMonthChange,
  onExport,
  exportDisabled,
  children,
}: TableFilterBarProps) {
  const { t } = useTranslation()

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const currentYear = new Date().getFullYear()
  const years = useMemo(
    () => Array.from({ length: currentYear - 2000 + 1 }, (_, i) => currentYear - i),
    [currentYear],
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      {children}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">{t(`${translationPrefix}.table.filters.year`)}</label>
        <Select
          value={year !== undefined ? String(year) : ALL}
          onValueChange={(val) => {
            if (val === ALL) {
              onYearChange(undefined)
              onMonthChange(undefined)
            } else {
              onYearChange(Number(val))
            }
          }}
        >
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t(`${translationPrefix}.table.filters.allYears`)}</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {year !== undefined && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t(`${translationPrefix}.table.filters.month`)}</label>
          <Select
            value={month !== undefined ? String(month) : ALL}
            onValueChange={(val) => onMonthChange(val === ALL ? undefined : Number(val))}
          >
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t(`${translationPrefix}.table.filters.allMonths`)}</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "long" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onExport}
        disabled={exportDisabled}
        className="ml-auto"
      >
        <Download className="h-4 w-4 mr-2" />
        {t(`${translationPrefix}.table.actions.export`)}
      </Button>
    </div>
  )
}

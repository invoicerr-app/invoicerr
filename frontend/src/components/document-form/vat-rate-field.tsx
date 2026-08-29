import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useState } from "react"
import { useFormContext, useWatch } from "react-hook-form"

import { BetterInput } from "@/components/better-input"
import type { LineItemTranslationPrefix } from "@/lib/line-item-schema"
import type { ReactNode } from "react"
import type { VatRatesUnavailableReason } from "@/types"
import { useCompany } from "@/hooks/queries/use-company"
import { useTranslation } from "react-i18next"
import { useVatRates } from "@/hooks/queries/use-vat-rates"

const CUSTOM_VALUE = "__custom__"

const UNAVAILABLE_REASON_KEY: Record<VatRatesUnavailableReason, string> = {
  NOT_A_VAT_SYSTEM: "common.vatRates.unavailable.notAVatSystem",
  DESTINATION_BASED_SYSTEM: "common.vatRates.unavailable.destinationBasedSystem",
  NO_CATALOG_YET: "common.vatRates.unavailable.noCatalogYet",
}

interface VatRateFieldProps {
  index: number
  translationPrefix: LineItemTranslationPrefix
}

/**
 * The invoice/quote line's VAT rate — a CHOICE from the active company's country catalog
 * (`GET /api/compliance/vat-rates`), with a free-text escape hatch always available.
 *
 * Deliberately writes to the SAME `items.${index}.vatRate` number the free-text input always wrote
 * to: this is an alternate INPUT WIDGET, not a new field. The backend still receives exactly one
 * number either way, so nothing about how the compliance engine resolves tax
 * (`compliance/engine/tax-engine.ts`) changes because of this picker.
 *
 * A country with no sourced catalog (most countries, and any whose tax isn't rate-per-country at
 * all — e.g. US sales tax) falls back to the plain numeric input, with a short explanation instead
 * of silence — never a blocked form.
 */
export function VatRateField({ index, translationPrefix }: VatRateFieldProps) {
  const { t } = useTranslation()
  const { control, setValue } = useFormContext()
  const vatRate = useWatch({ control, name: `items.${index}.vatRate` })

  const { data: company } = useCompany()
  const { data: vatRatesInfo } = useVatRates(company?.countryCode)
  const catalog = vatRatesInfo?.rates ?? []
  const hasCatalog = catalog.length > 0
  const matched = catalog.find((r) => r.rate === vatRate)

  // Starts in free-entry mode whenever the current value isn't one of the catalog's — covers a
  // brand-new row (NaN), a legacy/custom rate, and "no catalog for this country" alike.
  const [customMode, setCustomMode] = useState(!matched)

  // If the value drifts away from every catalog entry (article picker, manual edit while still in
  // catalog mode) fall back to free entry rather than silently keeping a stale selection on screen.
  // One-directional on purpose: once the user has chosen free entry, a value that happens to match a
  // catalog rate mid-typing must NOT yank the input away from them.
  useEffect(() => {
    if (!customMode && hasCatalog && !matched) {
      setCustomMode(true)
    }
  }, [customMode, hasCatalog, matched])

  const renderNumericField = (extra?: ReactNode) => (
    <FormField
      control={control}
      name={`items.${index}.vatRate`}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <BetterInput
              {...field}
              defaultValue={field.value || 0}
              postAdornment="%"
              type="number"
              step="0.01"
              data-cy={`item-vat-rate-${index}`}
              placeholder={t(`${translationPrefix}.upsert.form.items.vatRate.placeholder`)}
              onChange={(e) =>
                field.onChange(
                  e.target.value === "" ? undefined : Number.parseFloat(e.target.value.replace(",", ".")),
                )
              }
            />
          </FormControl>
          <FormMessage />
          {extra}
        </FormItem>
      )}
    />
  )

  if (!hasCatalog) {
    return renderNumericField(
      vatRatesInfo?.unavailableReason ? (
        <p className="text-xs text-muted-foreground">
          {t(UNAVAILABLE_REASON_KEY[vatRatesInfo.unavailableReason])}
        </p>
      ) : undefined,
    )
  }

  if (customMode) {
    return renderNumericField(
      <button
        type="button"
        className="w-fit text-left text-xs text-muted-foreground underline"
        onClick={() => setCustomMode(false)}
      >
        {t("common.vatRates.backToList")}
      </button>,
    )
  }

  return (
    <FormItem>
      <Select
        value={matched?.id ?? ""}
        onValueChange={(val) => {
          if (val === CUSTOM_VALUE) {
            setCustomMode(true)
            return
          }
          const found = catalog.find((r) => r.id === val)
          if (found) setValue(`items.${index}.vatRate`, found.rate)
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-48"
          data-cy={`item-vat-rate-select-${index}`}
          aria-label={t("common.vatRates.selectAriaLabel") as string}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {catalog.map((rate) => (
            <SelectItem key={rate.id} value={rate.id}>
              {rate.label} — {rate.rate}%
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>{t("common.vatRates.customOption")}</SelectItem>
        </SelectContent>
      </Select>
    </FormItem>
  )
}

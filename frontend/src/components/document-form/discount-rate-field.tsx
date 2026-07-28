import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

import { BetterInput } from "@/components/better-input"
import type { LineItemTranslationPrefix } from "@/lib/line-item-schema"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface DiscountRateFieldProps {
  translationPrefix: LineItemTranslationPrefix
}

/**
 * Percentage discount field with the "empty input means 0" semantics shared
 * by the invoice and quote upserts. (The proforma/final invoice modes use a
 * different "empty means null" input on purpose and stay inline.)
 */
export function DiscountRateField({ translationPrefix }: DiscountRateFieldProps) {
  const { t } = useTranslation()
  const { control } = useFormContext()

  return (
    <FormField
      control={control}
      name="discountRate"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(`${translationPrefix}.upsert.form.discountRate.label`)}</FormLabel>
          <FormControl>
            <BetterInput
              {...field}
              defaultValue={field.value ?? 0}
              postAdornment="%"
              type="number"
              step="0.01"
              placeholder={t(`${translationPrefix}.upsert.form.discountRate.placeholder`)}
              onChange={(e) =>
                field.onChange(
                  e.target.value === "" ? 0 : Number.parseFloat(e.target.value.replace(",", ".")),
                )
              }
            />
          </FormControl>
          <FormDescription>{t(`${translationPrefix}.upsert.form.discountRate.description`)}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

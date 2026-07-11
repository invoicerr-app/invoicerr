import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import type { LineItemTranslationPrefix } from "@/lib/line-item-schema"
import { PaymentMethodType, type PaymentMethod } from "@/types"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface PaymentMethodFieldProps {
  translationPrefix: LineItemTranslationPrefix
  paymentMethods: PaymentMethod[] | null | undefined
  required?: boolean
  triggerClassName?: string
}

export function PaymentMethodField({
  translationPrefix,
  paymentMethods,
  required,
  triggerClassName,
}: PaymentMethodFieldProps) {
  const { t } = useTranslation()
  const { control } = useFormContext()

  const typeLabel = (pm: PaymentMethod) =>
    pm.type === PaymentMethodType.BANK_TRANSFER
      ? t("paymentMethods.fields.type.bank_transfer")
      : pm.type === PaymentMethodType.PAYPAL
        ? t("paymentMethods.fields.type.paypal")
        : pm.type === PaymentMethodType.CHECK
          ? t("paymentMethods.fields.type.check")
          : pm.type === PaymentMethodType.CASH
            ? t("paymentMethods.fields.type.cash")
            : pm.type === PaymentMethodType.OTHER
              ? t("paymentMethods.fields.type.other")
              : pm.type

  return (
    <FormField
      control={control}
      name="paymentMethodId"
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required}>
            {t(`${translationPrefix}.upsert.form.paymentMethod.label`)}
          </FormLabel>
          <FormControl>
            <Select value={field.value ?? ""} onValueChange={(val) => field.onChange(val || "")}>
              <SelectTrigger
                className={triggerClassName}
                aria-label={t(`${translationPrefix}.upsert.form.paymentMethod.label`) as string}
              >
                <SelectValue placeholder={t(`${translationPrefix}.upsert.form.paymentMethod.placeholder`)} />
              </SelectTrigger>
              <SelectContent>
                {(paymentMethods ?? []).map((pm) => (
                  <SelectItem key={pm.id} value={pm.id}>
                    {pm.name} - {typeLabel(pm)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
          <FormDescription>{t(`${translationPrefix}.upsert.form.paymentMethod.description`)}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

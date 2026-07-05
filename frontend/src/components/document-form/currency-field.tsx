import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

import CurrencySelect from "@/components/currency-select"
import type { LineItemTranslationPrefix } from "@/lib/line-item-schema"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface CurrencyFieldProps {
    translationPrefix: LineItemTranslationPrefix
    dataCy?: string
}

export function CurrencyField({ translationPrefix, dataCy }: CurrencyFieldProps) {
    const { t } = useTranslation()
    const { control } = useFormContext()

    return (
        <FormField
            control={control}
            name="currency"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{t(`${translationPrefix}.upsert.form.currency.label`)}</FormLabel>
                    <FormControl>
                        <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy={dataCy} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    )
}

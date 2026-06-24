import { useEffect } from "react"
import type { UseFormReturn } from "react-hook-form"
import { countryToCurrency } from "@/lib/constants/country-to-currency"

export function useCountryToCurrency(
  form: UseFormReturn<any>,
  countryFieldName = "country",
  currencyFieldName = "currency"
) {
  const country = form.watch(countryFieldName)

  useEffect(() => {
    if (country && countryToCurrency[country]) {
      form.setValue(currencyFieldName, countryToCurrency[country])
    }
  }, [country, form, countryFieldName, currencyFieldName])
}

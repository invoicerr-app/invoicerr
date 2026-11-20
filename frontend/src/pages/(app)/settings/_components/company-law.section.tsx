import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"
import CurrencySelect from "@/components/currency-select"
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type CompanyLawFormField, useCompanyLawSettings } from "@/hooks/use-company-law"
import type { CompanyLawForm } from "@/lib/company-law"
import { SettingsFieldGroup } from "@/components/settings-section"

interface CompanyLawValues {
  companyLaw: CompanyLawForm
  currency: string
}

function MoneyField({
  field,
  defaultCurrency,
}: Readonly<{ field: CompanyLawFormField; defaultCurrency: string }>) {
  const { t } = useTranslation()
  const form = useFormContext<CompanyLawValues>()
  const value = form.watch(`companyLaw.values.${field.key}`)
  const money = typeof value === "object" && value ? value : { amount: "", currency: defaultCurrency }
  const set = (next: Partial<typeof money>) =>
    form.setValue(`companyLaw.values.${field.key}`, { ...money, ...next }, { shouldDirty: true })

  return (
    <FormItem>
      <FormLabel required={field.required}>{field.label}</FormLabel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <FormControl>
          <Input
            dir="ltr"
            inputMode="decimal"
            value={money.amount}
            placeholder={t("settings.company.form.companyLaw.amountPlaceholder")}
            onChange={(event) => set({ amount: event.target.value })}
            data-cy={`company-law-${field.key}-amount`}
          />
        </FormControl>
        <div className="sm:w-48">
          <CurrencySelect
            value={money.currency || defaultCurrency}
            onChange={(currency) => set({ currency: String(currency) })}
            data-cy={`company-law-${field.key}-currency`}
          />
        </div>
      </div>
    </FormItem>
  )
}

/**
 * The legal form and the company-law values the selected country's `companyLaw` section asks for.
 * Shown only when that country declares legal forms; every label and field comes from the API.
 */
export function CompanyLawSection({ countryCode }: Readonly<{ countryCode: string | undefined }>) {
  const { t } = useTranslation()
  const form = useFormContext<CompanyLawValues>()
  const { data: settings } = useCompanyLawSettings(countryCode)
  const legalForm = form.watch("companyLaw.legalForm")
  const defaultCurrency = form.watch("currency") || "EUR"

  if (!settings?.legalForms.length) return null
  const selected = settings.legalForms.find((candidate) => candidate.code === legalForm)

  return (
    <SettingsFieldGroup
      dataCy="company-law-group"
      legend={t("settings.company.form.companyLaw.label")}
      help={t("settings.company.form.companyLaw.description")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="companyLaw.legalForm"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel required>{settings.legalFormLabel}</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-cy="company-legal-form-select">
                    <SelectValue placeholder={t("settings.company.form.companyLaw.legalFormPlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {settings.legalForms.map((option) => (
                    <SelectItem
                      key={option.code}
                      value={option.code}
                      data-cy={`company-legal-form-option-${option.code}`}
                    >
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {selected?.fields.map((field) =>
          field.kind === "money" ? (
            <MoneyField key={field.key} field={field} defaultCurrency={defaultCurrency} />
          ) : (
            <FormField
              key={field.key}
              control={form.control}
              name={`companyLaw.values.${field.key}`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel required={field.required}>{field.label}</FormLabel>
                  <FormControl>
                    <Input
                      value={typeof input.value === "string" ? input.value : ""}
                      onChange={input.onChange}
                      onBlur={input.onBlur}
                      name={input.name}
                      ref={input.ref}
                      placeholder={field.label}
                      data-cy={`company-law-${field.key}`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        )}
      </div>
    </SettingsFieldGroup>
  )
}

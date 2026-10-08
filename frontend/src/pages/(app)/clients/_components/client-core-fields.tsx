import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import CountrySelect from "@/components/country-select"
import type { FieldValues, UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface ClientTypeAndNameFieldsProps {
  readonly form: UseFormReturn<FieldValues>
  readonly clientType: string
}

/** The client type and the name (company) or first/last name (individual): the identity every client
 *  form, quick or full, starts from. Renders grid cells, so the caller owns the grid. */
export function ClientTypeAndNameFields({ form, clientType }: ClientTypeAndNameFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <FormField
        control={form.control}
        name="type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("clients.upsert.fields.type.label") || "Client type"}</FormLabel>
            <FormControl>
              <Select value={field.value || "COMPANY"} onValueChange={(value) => field.onChange(value)}>
                <SelectTrigger dataCy="client-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY" dataCy="client-type-company">
                    {t("clients.upsert.fields.type.company") || "Company"}
                  </SelectItem>
                  <SelectItem value="INDIVIDUAL" dataCy="client-type-individual">
                    {t("clients.upsert.fields.type.individual") || "Individual"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {clientType === "COMPANY" ? (
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.name.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.name.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <>
          <FormField
            control={form.control}
            name="contactFirstname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("clients.upsert.fields.contactFirstname.label")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t("clients.upsert.fields.contactFirstname.placeholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactLastname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("clients.upsert.fields.contactLastname.label")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t("clients.upsert.fields.contactLastname.placeholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </>
  )
}

export function ClientCountryField({ form }: Readonly<{ form: UseFormReturn<FieldValues> }>) {
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name="country"
      render={({ field }) => (
        <FormItem>
          <FormLabel required>{t("clients.upsert.fields.country.label")}</FormLabel>
          <FormControl>
            <CountrySelect
              value={field.value}
              onChange={(value) => field.onChange(value)}
              onCountryCodeChange={(code) => form.setValue("countryCode", code as never)}
              data-cy="client-country-select"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

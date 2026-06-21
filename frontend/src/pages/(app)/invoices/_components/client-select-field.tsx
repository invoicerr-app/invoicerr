import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

import type { Client } from "@/types"
import { Button } from "@/components/ui/button"
import SearchSelect from "@/components/search-input"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"

interface ClientSelectFieldProps {
    translationPrefix: "invoices" | "recurringInvoices"
    dataCy: string
    clients: Client[]
    onSearchChange: (term: string) => void
    onRequestCreateClient: () => void
}

export function ClientSelectField({ translationPrefix, dataCy, clients, onSearchChange, onRequestCreateClient }: ClientSelectFieldProps) {
    const { t } = useTranslation()
    const { control } = useFormContext()

    return (
        <FormField
            control={control}
            name="clientId"
            render={({ field }) => (
                <FormItem>
                    <FormLabel required>{t(`${translationPrefix}.upsert.form.client.label`)}</FormLabel>
                    <FormControl>
                        <SearchSelect
                            options={(clients || []).map((c) => ({ label: c.name || c.contactFirstname + " " + c.contactLastname, value: c.id }))}
                            value={field.value ?? ""}
                            onValueChange={(val) => field.onChange(val || null)}
                            onSearchChange={onSearchChange}
                            placeholder={t(`${translationPrefix}.upsert.form.client.placeholder`)}
                            data-cy={dataCy}
                            noResultsComponent={
                                <Button
                                    variant="link"
                                    onClick={onRequestCreateClient}
                                >
                                    {t(`${translationPrefix}.upsert.form.client.noOptions`)}
                                </Button>
                            }
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    )
}

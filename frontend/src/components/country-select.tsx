import SearchSelect from "@/components/search-input"
import { countryCodes } from "@/lib/constants/countries"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

interface CountrySelectProps {
    value: string | null | undefined
    onChange: (value: string | string[]) => void
    'data-cy'?: string
}

export default function CountrySelect({ value, onChange, 'data-cy': dataCyValue }: CountrySelectProps) {
    const { t, i18n } = useTranslation()

    const allOptions = useMemo(() => {
        const displayNames = new Intl.DisplayNames([i18n.language, "en"], { type: "region" })
        const options = countryCodes.map((code) => {
            const label = displayNames.of(code) || code
            return { label, value: label }
        })

        // Preserve a previously saved free-text value not present in the list (legacy data, other language, etc.)
        if (value && !options.some((option) => option.value === value)) {
            options.unshift({ label: value, value })
        }

        return options.sort((a, b) => a.label.localeCompare(b.label))
    }, [i18n.language, value])

    const [options, setOptions] = useState(allOptions)

    useEffect(() => {
        setOptions(allOptions)
    }, [allOptions])

    const handleSearchChange = (search: string) => {
        if (!search) {
            setOptions(allOptions)
            return
        }
        setOptions(allOptions.filter((option) => option.label.toLowerCase().includes(search.toLowerCase())))
    }

    return (
        <SearchSelect
            options={options}
            allOptions={allOptions}
            value={value || undefined}
            multiple={false}
            onValueChange={onChange}
            onSearchChange={handleSearchChange}
            placeholder={t("component.country-select.placeholder")}
            searchPlaceholder={t("component.country-select.searchPlaceholder")}
            noResultsText={t("component.country-select.noResults")}
            className="w-full"
            data-cy={dataCyValue}
        />
    )
}

import type { FieldValues, UseFormReturn } from "react-hook-form"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { useState } from "react"

interface SireneCompany {
    name?: string
    legalId?: string
    VAT?: string
    address?: string
    postalCode?: string
    city?: string
    state?: string
    country?: string
    foundedAt?: string
}

interface UseLookupSiretMessages {
    invalid: string
    notFound: string
    success: string
    error: string
}

interface UseLookupSiretOptions {
    messages: UseLookupSiretMessages
}

export function useLookupSiret<T extends FieldValues>(form: UseFormReturn<T>, { messages }: UseLookupSiretOptions) {
    const [isLoading, setIsLoading] = useState(false)

    const lookup = async (rawSiret: string | undefined) => {
        const siret = (rawSiret || "").replace(/\D/g, "")
        if (siret.length !== 14) {
            toast.error(messages.invalid)
            return
        }

        setIsLoading(true)
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
            const res = await authenticatedFetch(`${backendUrl}/api/sirene/siret/${siret}`)
            if (!res.ok) throw new Error(`Sirene lookup failed with status ${res.status}`)

            const { found, company } = (await res.json()) as { found: boolean; company: SireneCompany | null }
            if (!found || !company) {
                toast.error(messages.notFound)
                return
            }

            const formValues = form.getValues()
            const setIfExists = (key: string, value: unknown) => {
                if (value !== undefined && key in formValues) {
                    form.setValue(key as any, value as any)
                }
            }

            setIfExists("name", company.name)
            setIfExists("VAT", company.VAT)
            setIfExists("address", company.address)
            setIfExists("postalCode", company.postalCode)
            setIfExists("city", company.city)
            setIfExists("state", company.state)
            setIfExists("country", company.country)
            if (company.foundedAt) setIfExists("foundedAt", new Date(company.foundedAt))
            setIfExists("legalId", company.legalId || siret)

            toast.success(messages.success)
        } catch (err) {
            console.error(err)
            toast.error(messages.error)
        } finally {
            setIsLoading(false)
        }
    }

    return { lookup, isLoading }
}

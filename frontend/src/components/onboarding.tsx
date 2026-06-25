"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

import { Button } from "@/components/ui/button"
import type { Company } from "@/types"
import CountrySelect from "@/components/country-select"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { usePost } from "@/hooks/use-fetch"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers"

interface OnBoardingProps {
  isLoading?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function OnBoarding({
  isLoading: externalLoading,
  isOpen = true,
  onOpenChange,
}: OnBoardingProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)

  const { trigger } = usePost<Company>("/api/company/info")

  const companySchema = z.object({
    name: z
      .string({ required_error: t("settings.company.form.company.errors.required") })
      .min(1, t("settings.company.form.company.errors.empty"))
      .max(100, t("settings.company.form.company.errors.maxLength")),
    country: z.string().min(1, t("settings.company.form.country.errors.empty")),
    countryCode: z.string().optional(),
    identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
  })

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      country: "",
      countryCode: "",
      identifiers: [],
    },
  })

  const loading = isLoading || externalLoading

  const countryCodeValue = form.watch("countryCode")
  const { data: requiredIdentifiers } = useRequiredIdentifiers(countryCodeValue || undefined, "COMPANY")

  useEffect(() => {
    if (!requiredIdentifiers) return
    const requiredSchemes = new Set(requiredIdentifiers.map((r) => r.scheme))
    const current: { scheme: string; value: string }[] = form.getValues("identifiers") || []
    const formSchemes = new Set(current.map((i) => i.scheme))
    const next = [...current]
    let changed = false
    for (const scheme of requiredSchemes) {
      if (!formSchemes.has(scheme)) {
        next.push({ scheme, value: "" })
        changed = true
      }
    }
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].scheme && !requiredSchemes.has(next[i].scheme)) {
        next.splice(i, 1)
        changed = true
      }
    }
    if (changed) {
      form.setValue("identifiers", next)
    }
  }, [requiredIdentifiers, form])

  async function onSubmit(values: z.infer<typeof companySchema>) {
    if (requiredIdentifiers) {
      for (const req of requiredIdentifiers) {
        if (req.required) {
          const val = (values.identifiers || []).find((i) => i.scheme === req.scheme)?.value
          if (!val || val.trim() === '') {
            const idx = (values.identifiers || []).findIndex((i) => i.scheme === req.scheme)
            form.setError(`identifiers.${idx}.value` as any, { message: `${req.label} is required` })
            return
          }
        }
      }
    }

    setIsLoading(true)
    try {
      const payload = {
        ...values,
        identifiers: (values.identifiers || []).filter((i) => i.value.trim() !== ""),
      }
      await trigger(payload)
      toast.success(t("settings.company.messages.updateSuccess"))
      onOpenChange?.(false)
    } catch (error) {
      console.error("Error during onboarding:", error)
      toast.error(t("settings.company.messages.updateError"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-lg"
        data-cy="onboarding-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("settings.company.title")}</DialogTitle>
          <DialogDescription>{t("settings.company.description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("settings.company.form.company.label")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("settings.company.form.company.placeholder")} {...field} data-cy="onboarding-company-name-input" />
                  </FormControl>
                  <FormDescription>{t("settings.company.form.company.description")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("settings.company.form.country.label")}</FormLabel>
                  <FormControl>
                    <CountrySelect value={field.value} onChange={(value) => field.onChange(value)} onCountryCodeChange={(code) => form.setValue('countryCode', code)} data-cy="onboarding-company-country-input" />
                  </FormControl>
                  <FormDescription>{t("settings.company.form.country.description")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requiredIdentifiers?.length ? (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <p className="text-sm font-medium text-muted-foreground">{t("settings.company.form.identifiers.label") || "Country-specific identifiers"}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {requiredIdentifiers.map((req) => {
                    const current = form.watch("identifiers") || []
                    const formIndex = current.findIndex((i: any) => i.scheme === req.scheme)
                    if (formIndex < 0) return null
                    return (
                      <FormField
                        key={req.scheme}
                        control={form.control}
                        name={`identifiers.${formIndex}.value`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required={req.required}>{req.label}</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder={req.label} data-cy={req.scheme === "LEGAL_ID" ? "onboarding-legalid-input" : req.scheme === "VAT" ? "onboarding-vat-input" : undefined} />
                            </FormControl>
                            {req.helpText && (
                              <p className="text-xs text-muted-foreground">{req.helpText}</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={loading} data-cy="onboarding-submit-btn">
                {loading ? t("common.loading") : t("common.finish")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

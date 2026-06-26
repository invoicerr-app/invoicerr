"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

import { Button } from "@/components/ui/button"
import type { Company } from "@/types"
import CountrySelect from "@/components/country-select"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { usePost } from "@/hooks/use-fetch"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

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
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)

  const { trigger } = usePost<Company>("/api/company/info")

  const companySchema = z.object({
    name: z
      .string({ required_error: t("settings.company.form.company.errors.required") })
      .min(1, t("settings.company.form.company.errors.empty"))
      .max(100, t("settings.company.form.company.errors.maxLength")),
    country: z.string().min(1, t("settings.company.form.country.errors.empty")),
  })

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      country: "",
    },
  })

  const loading = isLoading || externalLoading

  async function onSubmit(values: z.infer<typeof companySchema>) {
    setIsLoading(true)
    try {
      await trigger(values)
      toast.success(t("settings.company.messages.updateSuccess"))
      onOpenChange?.(false)
      navigate("/settings/company")
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
                    <CountrySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy="onboarding-company-country-input" />
                  </FormControl>
                  <FormDescription>{t("settings.company.form.country.description")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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

"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

import { AlertCircle, Check, Loader2, Search } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import ChannelConnectPrompt from "@/components/channel-connect-prompt"
import type { Company } from "@/types"
import CountrySelect from "@/components/country-select"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { usePost } from "@/hooks/use-fetch"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRequiredIdentifiers } from "@/hooks/use-required-identifiers"
import { useLookupSiret } from "@/hooks/use-lookup-siret"

interface OnBoardingProps {
  isLoading?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  // Reused both for first-run onboarding (POST /api/company/info, the
  // singleton "no company yet" flow) and for creating an additional company
  // from the switcher (POST /api/companies) — same form, different target.
  endpoint?: string
  onSuccess?: (company: Company) => void
}

// Two-step wizard: Step 1 creates the company (unchanged contract — same
// fields, same data-cy, same POST). Step 2 is an optional, never-blocking
// nudge to connect the country's e-invoicing channel(s); "Finish" there is
// what used to happen on Step 1 success (close the dialog + onSuccess/navigate).
type WizardStep = "company" | "channels"

export default function OnBoarding({
  isLoading: externalLoading,
  isOpen = true,
  onOpenChange,
  endpoint = "/api/company/info",
  onSuccess,
}: OnBoardingProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<WizardStep>("company")
  const [createdCompany, setCreatedCompany] = useState<Company | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { trigger } = usePost<Company>(endpoint)

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

  const identifiers = form.watch("identifiers") || []
  const legalIdValue = identifiers.find((i) => i.scheme === "LEGAL_ID")?.value || ""
  const countryValue = form.watch("country")
  const isFranceOrUnset = !countryValue || /^fr(ance)?$/i.test(countryValue.trim())
  const { lookup: onLookupSiret, isLoading: siretLookupLoading } = useLookupSiret(form, {
    messages: {
      invalid: t("clients.upsert.messages.siretInvalid"),
      notFound: t("clients.upsert.messages.siretNotFound"),
      success: t("clients.upsert.messages.siretSuccess"),
      error: t("clients.upsert.messages.siretError"),
    },
  })
  const isSiretLookupDisabled =
    siretLookupLoading || !legalIdValue || legalIdValue.replace(/\D/g, "").length !== 14

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

  // Brings the wizard back to a clean slate so the next time it's opened
  // (e.g. the switcher's "add company" after a previous completion) it
  // starts at Step 1 again instead of resuming wherever it was left.
  function resetWizard() {
    setStep("company")
    setCreatedCompany(null)
    setSubmitError(null)
    form.reset()
  }

  // The former single-step completion logic — now triggered from Step 2
  // ("Finish" or "Connect channels") instead of Step 1 success.
  function completeOnboarding(destination: string) {
    const company = createdCompany
    resetWizard()
    onOpenChange?.(false)
    if (!company) return
    if (onSuccess) {
      onSuccess(company)
    } else {
      navigate(destination)
    }
  }

  async function onSubmit(values: z.infer<typeof companySchema>) {
    if (requiredIdentifiers) {
      for (const req of requiredIdentifiers) {
        if (req.required) {
          const val = (values.identifiers || []).find((i) => i.scheme === req.scheme)?.value
          if (!val || val.trim() === "") {
            const idx = (values.identifiers || []).findIndex((i) => i.scheme === req.scheme)
            form.setError(`identifiers.${idx}.value` as any, { message: `${req.label} is required` })
            return
          }
        }
      }
    }

    setIsLoading(true)
    setSubmitError(null)
    try {
      const payload = {
        ...values,
        identifiers: (values.identifiers || []).filter((i) => i.value.trim() !== ""),
      }
      const created = await trigger(payload)
      if (!created) {
        const message = t("settings.company.messages.updateError")
        setSubmitError(message)
        toast.error(message)
        return
      }
      toast.success(t("settings.company.messages.updateSuccess"))
      // Company is created now (same as before) — only the dialog close +
      // onSuccess/navigate moves to Step 2's Finish button.
      setCreatedCompany(created)
      setStep("channels")
    } catch (error) {
      console.error("Error during onboarding:", error)
      const message = t("settings.company.messages.updateError")
      setSubmitError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const stepNumber = step === "company" ? 1 : 2

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
          <DialogTitle>
            {step === "company"
              ? t("settings.company.title")
              : t("settings.company.onboarding.step2Title", "Connect your e-invoicing channel")}
          </DialogTitle>
          <DialogDescription>
            {step === "company"
              ? t("settings.company.description")
              : t(
                  "settings.company.onboarding.step2Description",
                  "Your company has been created. Connect an e-invoicing channel now, or do it later from Settings.",
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-1 pb-2" data-cy="onboarding-stepper">
          <div className="flex items-center gap-3">
            {(["company", "channels"] as const).map((s, i) => {
              const isActive = step === s
              const isDone = step === "channels" && s === "company"
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                        isDone
                          ? "border-primary bg-primary text-primary-foreground"
                          : isActive
                            ? "border-primary text-primary"
                            : "border-muted-foreground/30 text-muted-foreground",
                      )}
                    >
                      {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "text-sm",
                        isActive ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s === "company"
                        ? t("settings.company.onboarding.stepLabelCompany", "Company")
                        : t("settings.company.onboarding.stepLabelChannels", "Channels")}
                    </span>
                  </div>
                  {i === 0 && <div className="h-px w-8 bg-border" />}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.company.onboarding.stepIndicator", "Step {{current}} of {{total}}", {
              current: stepNumber,
              total: 2,
            })}
          </p>
        </div>

        {step === "company" ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {submitError && (
                <Alert variant="destructive" data-cy="onboarding-error-alert">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>
                    {t("settings.company.onboarding.errorTitle", "Couldn't create your company")}
                  </AlertTitle>
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("settings.company.form.country.label")}</FormLabel>
                    <FormControl>
                      <CountrySelect
                        value={field.value}
                        onChange={(value) => field.onChange(value)}
                        onCountryCodeChange={(code) => form.setValue("countryCode", code)}
                        data-cy="onboarding-company-country-input"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.country.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {requiredIdentifiers?.length ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("settings.company.form.identifiers.label") || "Country-specific identifiers"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {requiredIdentifiers.map((req) => {
                      const current = form.watch("identifiers") || []
                      const formIndex = current.findIndex((i: any) => i.scheme === req.scheme)
                      if (formIndex < 0) return null
                      const isLegalId = req.scheme === "LEGAL_ID"
                      return (
                        <FormField
                          key={req.scheme}
                          control={form.control}
                          name={`identifiers.${formIndex}.value`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required={req.required}>{req.label}</FormLabel>
                              <FormControl>
                                <div className="flex gap-2">
                                  <Input
                                    {...field}
                                    placeholder={req.label}
                                    data-cy={
                                      isLegalId
                                        ? "onboarding-legalid-input"
                                        : req.scheme === "VAT"
                                          ? "onboarding-vat-input"
                                          : undefined
                                    }
                                  />
                                  {isLegalId && isFranceOrUnset && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      disabled={isSiretLookupDisabled}
                                      onClick={() => onLookupSiret(legalIdValue)}
                                      title={t("clients.upsert.actions.lookupSiret")}
                                      data-cy="onboarding-siret-lookup"
                                    >
                                      {siretLookupLoading ? <Loader2 className="animate-spin" /> : <Search />}
                                    </Button>
                                  )}
                                </div>
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

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("settings.company.form.company.label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("settings.company.form.company.placeholder")}
                        {...field}
                        data-cy="onboarding-company-name-input"
                      />
                    </FormControl>
                    <FormDescription>{t("settings.company.form.company.description")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={loading} data-cy="onboarding-submit-btn">
                  {loading
                    ? t("common.loading")
                    : submitError
                      ? t("settings.company.onboarding.retry", "Retry")
                      : t("common.next", "Next")}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-6">
            <ChannelConnectPrompt />

            <div className="flex justify-between pt-4">
              <Button
                type="button"
                variant="outline"
                data-cy="onboarding-connect-channels-btn"
                onClick={() => completeOnboarding("/settings/channels")}
              >
                {t("settings.company.onboarding.connectChannels", "Connect channels")}
              </Button>
              <Button
                type="button"
                data-cy="onboarding-finish-btn"
                onClick={() => completeOnboarding("/settings/company")}
              >
                {t("common.finish")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

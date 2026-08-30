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

import { AlertCircle, Check, Info, Loader2, Search } from "lucide-react"
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
import { type LookupScheme, useCompanyLookup } from "@/hooks/use-company-lookup"

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

// Four-step wizard:
//   1. "country"    — just the country. Everything downstream (the identifier's
//      label, whether a search is even worth attempting) is a function of it.
//   2. "identifier" — one national-identifier field, labeled by whatever the
//      backend's company-lookup capability for that country returns
//      (`GET /company-lookup/capabilities/:countryCode`.identifierLabel) — this
//      component never names a country or an identifier scheme itself. "Next"
//      fires the lookup (when one is worth trying) and always advances
//      afterwards, found or not: a registration screen must never dead-end.
//   3. "company"    — the rest of the company form, pre-filled by whatever the
//      lookup found. Submits and creates the company (unchanged contract: same
//      POST, same data-cy on the fields that already existed).
//   4. "channels"   — the pre-existing, never-blocking channel-connect nudge.
type WizardStep = "country" | "identifier" | "company" | "channels"

const STEP_ORDER: WizardStep[] = ["country", "identifier", "company", "channels"]

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
  const [step, setStep] = useState<WizardStep>("country")
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
    // Left optional on purpose — the onboarding form only ever asked for
    // name + country; these are a bonus the company-lookup pre-fill can now
    // populate, not a new requirement to clear before a company can be created.
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })).optional(),
  })

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      country: "",
      countryCode: "",
      address: "",
      postalCode: "",
      city: "",
      state: "",
      // A LEGAL_ID row always exists from the start — Step 2 is dedicated to it
      // regardless of whether the country-identifiers catalog (which today only
      // covers a couple of countries) has anything to say about this country.
      identifiers: [{ scheme: "LEGAL_ID", value: "" }],
    },
  })

  const loading = isLoading || externalLoading

  const countryCodeValue = form.watch("countryCode")
  const { data: requiredIdentifiersResult } = useRequiredIdentifiers(countryCodeValue || undefined, "COMPANY")
  const requiredIdentifiers = requiredIdentifiersResult?.requirements

  const {
    lookup: onCompanyLookup,
    isLoading: companyLookupLoading,
    capability,
    isAvailable: canLookupCompany,
    coverage: lookupCoverage,
    schemes: lookupSchemes,
    identifierLabel: lookupIdentifierLabel,
  } = useCompanyLookup(form, {
    countryCode: form.watch("countryCode"),
    messages: {
      invalid: t("clients.upsert.messages.lookupInvalid"),
      notFound: t("clients.upsert.messages.lookupNotFound"),
      success: t("clients.upsert.messages.lookupSuccess"),
      error: t("clients.upsert.messages.lookupError"),
      unavailable: t("clients.upsert.messages.lookupUnavailable"),
    },
  })
  // The backend owns the per-country format rules; the button only needs a value.
  const canLookupScheme = (scheme: string) => canLookupCompany && lookupSchemes.includes(scheme as never)

  // A search is worth attempting automatically only when a REAL national register
  // answered — the worldwide directories (GLEIF, Peppol) technically "cover" every
  // country too, but they only ever list the businesses that opted in, so a bare
  // "AVAILABLE" is not the same promise as "AVAILABLE and REGISTER-grade" (see
  // registry.ts's own `coverage` field and its capabilities()/note logic). This is
  // the actual line between "a country with a fournisseur" and one without, for a
  // small business's onboarding — a capability object that is merely `AVAILABLE`
  // but `PARTIAL` is, in practice, "no automatic search worth running".
  const capabilityLoaded = capability !== undefined
  const canAutoSearch = canLookupCompany && lookupCoverage === "REGISTER"

  const legalIdRequirement = requiredIdentifiers?.find((r) => r.scheme === "LEGAL_ID")
  const identifierFieldLabel =
    legalIdRequirement?.label ||
    lookupIdentifierLabel ||
    t("settings.company.onboarding.identifierStep.genericLabel", "National company identifier")

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
      // LEGAL_ID is always collected in Step 2, independent of whether the
      // country-identifiers catalog declares anything for this country — never
      // drop it here just because that catalog stays silent (it covers only a
      // couple of countries today).
      if (next[i].scheme && next[i].scheme !== "LEGAL_ID" && !requiredSchemes.has(next[i].scheme)) {
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
    setStep("country")
    setCreatedCompany(null)
    setSubmitError(null)
    form.reset()
  }

  // The former single-step completion logic — now triggered from the final
  // step ("Finish" or "Connect channels") instead of the company step's success.
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

  async function goToIdentifierStep() {
    const valid = await form.trigger(["country"])
    if (!valid) return
    setStep("identifier")
  }

  // Never a dead end: a required identifier still has to be typed, but whether
  // the lookup ran, found something, found nothing, or failed outright, this
  // always lands on the company step afterwards.
  async function goToCompanyStep() {
    const identifiers = form.getValues("identifiers") || []
    const legalIdIndex = identifiers.findIndex((i) => i.scheme === "LEGAL_ID")
    const legalIdValue = legalIdIndex >= 0 ? identifiers[legalIdIndex].value : ""

    if (legalIdRequirement?.required && !legalIdValue.trim()) {
      form.setError(`identifiers.${legalIdIndex}.value` as never, {
        message: `${legalIdRequirement.label} is required`,
      })
      return
    }

    if (canAutoSearch && legalIdValue.trim()) {
      await onCompanyLookup(legalIdValue, "LEGAL_ID")
    }
    setStep("company")
  }

  async function onSubmit(values: z.infer<typeof companySchema>) {
    if (requiredIdentifiers) {
      for (const req of requiredIdentifiers) {
        if (req.required) {
          const val = (values.identifiers || []).find((i) => i.scheme === req.scheme)?.value
          if (!val || val.trim() === "") {
            const idx = (values.identifiers || []).findIndex((i) => i.scheme === req.scheme)
            form.setError(`identifiers.${idx}.value` as never, { message: `${req.label} is required` })
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
      // onSuccess/navigate moves to the final step's Finish button.
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

  const stepNumber = STEP_ORDER.indexOf(step) + 1

  const stepLabels: Record<WizardStep, string> = {
    country: t("settings.company.onboarding.stepLabelCountry", "Country"),
    identifier: t("settings.company.onboarding.stepLabelIdentifier", "Identifier"),
    company: t("settings.company.onboarding.stepLabelCompany", "Company"),
    channels: t("settings.company.onboarding.stepLabelChannels", "Channels"),
  }
  const stepTitles: Record<WizardStep, string> = {
    country: t("settings.company.onboarding.countryStep.title", "Where is your company based?"),
    identifier: t("settings.company.onboarding.identifierStep.title", "Company identifier"),
    company: t("settings.company.title"),
    channels: t("settings.company.onboarding.step2Title", "Connect your e-invoicing channel"),
  }
  const stepDescriptions: Record<WizardStep, string> = {
    country: t(
      "settings.company.onboarding.countryStep.description",
      "This determines which national identifier we'll ask for next.",
    ),
    identifier: canAutoSearch
      ? t(
          "settings.company.onboarding.identifierStep.descriptionAvailable",
          "We'll search the official register to help fill in the rest of the form.",
        )
      : t(
          "settings.company.onboarding.identifierStep.descriptionUnavailable",
          "Enter it by hand — see below for why automatic search isn't available here.",
        ),
    company: t("settings.company.description"),
    channels: t(
      "settings.company.onboarding.step2Description",
      "Your company has been created. Connect an e-invoicing channel now, or do it later from Settings.",
    ),
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
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-1 pb-2" data-cy="onboarding-stepper">
          {/* Four steps (up from the old two) don't fit a `!max-w-lg` dialog at full
              width if every label is spelled out — only the ACTIVE step's label is
              shown, `flex-wrap` is a safety net against very long translations, so
              this never grows into a horizontal-scrolling stepper. */}
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
            {STEP_ORDER.map((s, i) => {
              const isActive = step === s
              const isDone = STEP_ORDER.indexOf(step) > i
              return (
                <div key={s} className="flex items-center gap-1.5">
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
                  {isActive && <span className="text-sm font-medium text-foreground">{stepLabels[s]}</span>}
                  {i < STEP_ORDER.length - 1 && <div className="h-px w-4 bg-border" />}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.company.onboarding.stepIndicator", "Step {{current}} of {{total}}", {
              current: stepNumber,
              total: STEP_ORDER.length,
            })}
          </p>
        </div>

        {step === "country" && (
          <Form {...form}>
            <div className="space-y-6">
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

              <div className="flex justify-end pt-4">
                <Button type="button" onClick={goToIdentifierStep} data-cy="onboarding-country-next-btn">
                  {t("common.next", "Next")}
                </Button>
              </div>
            </div>
          </Form>
        )}

        {step === "identifier" && (
          <Form {...form}>
            <div className="space-y-6">
              <FormField
                control={form.control}
                name={`identifiers.${Math.max(
                  0,
                  (form.watch("identifiers") || []).findIndex((i) => i.scheme === "LEGAL_ID"),
                )}.value`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required={!!legalIdRequirement?.required}>{identifierFieldLabel}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={identifierFieldLabel}
                        data-cy="onboarding-legalid-input"
                      />
                    </FormControl>
                    {legalIdRequirement?.helpText && (
                      <p className="text-xs text-muted-foreground">{legalIdRequirement.helpText}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {capabilityLoaded && !canAutoSearch && (
                <Alert data-cy="onboarding-identifier-no-lookup-note">
                  <Info className="h-4 w-4" />
                  <AlertTitle>
                    {t(
                      "settings.company.onboarding.identifierStep.noAutoSearchTitle",
                      "No automatic search for this country",
                    )}
                  </AlertTitle>
                  <AlertDescription>
                    {capability?.note ||
                      t(
                        "settings.company.onboarding.identifierStep.noAutoSearchFallback",
                        "No automatic company search is available for this country on this instance — enter the details by hand.",
                      )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("country")}
                  data-cy="onboarding-identifier-back-btn"
                >
                  {t("common.previous")}
                </Button>
                <Button
                  type="button"
                  disabled={companyLookupLoading}
                  onClick={goToCompanyStep}
                  data-cy="onboarding-identifier-next-btn"
                >
                  {companyLookupLoading && <Loader2 className="animate-spin" />}
                  {t("common.next", "Next")}
                </Button>
              </div>
            </div>
          </Form>
        )}

        {step === "company" && (
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.company.form.address.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.address.placeholder")}
                          {...field}
                          data-cy="onboarding-company-address-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.company.form.postalCode.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.postalCode.placeholder")}
                          {...field}
                          data-cy="onboarding-company-postalcode-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.company.form.city.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.city.placeholder")}
                          {...field}
                          data-cy="onboarding-company-city-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.company.form.state.label")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("settings.company.form.state.placeholder")}
                          {...field}
                          data-cy="onboarding-company-state-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {requiredIdentifiers?.filter((r) => r.scheme !== "LEGAL_ID").length ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("settings.company.form.identifiers.label") || "Country-specific identifiers"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {requiredIdentifiers
                      .filter((r) => r.scheme !== "LEGAL_ID")
                      .map((req) => {
                        const current = form.watch("identifiers") || []
                        const formIndex = current.findIndex((i) => i.scheme === req.scheme)
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
                                  <div className="flex gap-2">
                                    <Input
                                      {...field}
                                      placeholder={req.label}
                                      data-cy={req.scheme === "VAT" ? "onboarding-vat-input" : undefined}
                                    />
                                    {canLookupScheme(req.scheme) && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        disabled={companyLookupLoading || !String(field.value || "").trim()}
                                        onClick={() =>
                                          onCompanyLookup(field.value, req.scheme as LookupScheme)
                                        }
                                        title={
                                          lookupIdentifierLabel
                                            ? `${t("clients.upsert.actions.lookupCompany")} — ${lookupIdentifierLabel}`
                                            : t("clients.upsert.actions.lookupCompany")
                                        }
                                        data-cy="onboarding-company-lookup"
                                      >
                                        {companyLookupLoading ? (
                                          <Loader2 className="animate-spin" />
                                        ) : (
                                          <Search />
                                        )}
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

              <div className="flex justify-between pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("identifier")}
                  data-cy="onboarding-company-back-btn"
                >
                  {t("common.previous")}
                </Button>
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
        )}

        {step === "channels" && (
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

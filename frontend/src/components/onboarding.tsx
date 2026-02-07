"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { Button } from "@/components/ui/button"
import { Company } from "@/types"
import CurrencySelect from "@/components/currency-select"
import { DatePicker } from "@/components/date-picker"
import { Input } from "@/components/ui/input"
import { StepIndicator } from "./step-indicator"
import { Switch } from "@/components/ui/switch"
import { format } from "date-fns"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { usePost } from "@/hooks/use-fetch"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

interface OnBoardingProps {
  isLoading?: boolean
  isOpen?: boolean
}

export interface OnBoardingData {
  name: string
  description: string
  legalId?: string
  VAT?: string
  foundedAt: Date
  currency: string
  address: string
  postalCode: string
  city: string
  country: string
  phone: string
  email: string
  quoteStartingNumber: number
  quoteNumberFormat: string
  invoiceStartingNumber: number
  invoiceNumberFormat: string
  receiptStartingNumber: number
  receiptNumberFormat: string
  invoicePDFFormat: string
  dateFormat: string
  exemptVat?: boolean
}


export default function OnBoarding({
  isLoading: externalLoading,
  isOpen: isOpenProp = true,
}: OnBoardingProps) {
  const { t } = useTranslation()
  const STEPS = [
    { id: "basic", label: t("onboarding.steps.basic") },
    { id: "address", label: t("onboarding.steps.address") },
    { id: "contact", label: t("onboarding.steps.contact") },
    { id: "settings", label: t("onboarding.steps.settings") },
  ]
  const [isLoading, setIsLoading] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [isOpen, setIsOpen] = useState(isOpenProp ?? true)

  // Synchroniser l'état local avec la prop
  useEffect(() => {
    setIsOpen(isOpenProp ?? true)
  }, [isOpenProp])

  // First create/update company endpoint
  const { trigger: createCompany } = usePost<Company>("/api/company");
  // Update company info endpoint
  const { trigger: updateCompanyInfo } = usePost<Company>("/api/company/info");

  const ALLOWED_DATE_FORMATS = [
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "yyyy/MM/dd",
    "dd.MM.yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "EEEE, dd MMM yyyy",
  ]

  const validateNumberFormat = (pattern: string): boolean => {
    const patternRegex = /\{(\w+)(?::(\d+))?\}/g
    const validKeys = ["year", "month", "day", "number"]
    const requiredKeys = ["number"]

    const matches: RegExpExecArray[] = []
    let match = patternRegex.exec(pattern)

    while (match !== null) {
      matches.push(match)
      match = patternRegex.exec(pattern)
    }

    for (const key of requiredKeys) {
      if (!matches.some((m) => m[1] === key)) {
        return false
      }
    }

    for (const match of matches) {
      const key = match[1]
      const padding = match[2]

      if (!validKeys.includes(key)) {
        return false
      }

      if (padding !== undefined) {
        const paddingNum = Number.parseInt(padding, 10)
        if (isNaN(paddingNum) || paddingNum < 0 || paddingNum > 20) {
          return false
        }
      }
    }

    return true
  }

  const companySchema = z.object({
    name: z
      .string({ required_error: t("settings.company.form.company.errors.required") })
      .min(1, t("settings.company.form.company.errors.empty"))
      .max(100, t("settings.company.form.company.errors.maxLength")),
    description: z.string().max(500, t("settings.company.form.description.errors.maxLength")),
    legalId: z
      .string({ required_error: t("settings.company.form.legalId.errors.required") })
      .max(50, t("settings.company.form.legalId.errors.maxLength"))
      .optional(),
    VAT: z
      .string({ required_error: t("settings.company.form.vat.errors.required") })
      .max(15, t("settings.company.form.vat.errors.maxLength"))
      .optional(),
    foundedAt: z.date().refine((date) => date <= new Date(), t("settings.company.form.foundedAt.errors.future")),
    currency: z
      .string({ required_error: t("settings.company.form.currency.errors.required") })
      .min(1, t("settings.company.form.currency.errors.select")),
    address: z.string().min(1, t("settings.company.form.address.errors.empty")),
    addressLine2: z.string().optional(),
    postalCode: z.string().refine((val) => {
      return /^[0-9A-Z\s-]{3,10}$/.test(val)
    }, t("settings.company.form.postalCode.errors.format")),
    city: z.string().min(1, t("settings.company.form.city.errors.empty")),
    country: z.string().min(1, t("settings.company.form.country.errors.empty")),
    phone: z
      .string()
      .min(8, t("settings.company.form.phone.errors.minLength"))
      .refine((val) => {
        return /^[+]?[0-9\s\-()]{8,20}$/.test(val)
      }, t("settings.company.form.phone.errors.format")),
    email: z
      .string()
      .email()
      .min(1, t("settings.company.form.email.errors.required"))
      .refine((val) => {
        return z.string().email().safeParse(val).success
      }, t("settings.company.form.email.errors.format")),
    quoteStartingNumber: z.number().min(1, t("settings.company.form.quoteStartingNumber.errors.min")),
    quoteNumberFormat: z
      .string()
      .min(1, t("settings.company.form.quoteNumberFormat.errors.required"))
      .max(100, t("settings.company.form.quoteNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.quoteNumberFormat.errors.format")),
    invoiceStartingNumber: z.number().min(1, t("settings.company.form.invoiceStartingNumber.errors.min")),
    invoiceNumberFormat: z
      .string()
      .min(1, t("settings.company.form.invoiceNumberFormat.errors.required"))
      .max(100, t("settings.company.form.invoiceNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.invoiceNumberFormat.errors.format")),
    receiptStartingNumber: z.number().min(1, t("settings.company.form.receiptStartingNumber.errors.min")),
    receiptNumberFormat: z
      .string()
      .min(1, t("settings.company.form.receiptNumberFormat.errors.required"))
      .max(100, t("settings.company.form.receiptNumberFormat.errors.maxLength"))
      .refine((val) => {
        return validateNumberFormat(val)
      }, t("settings.company.form.receiptNumberFormat.errors.format")),
    invoicePDFFormat: z
      .string()
      .min(3, t("settings.company.form.invoicePDFFormat.errors.minLength"))
      .max(10, t("settings.company.form.invoicePDFFormat.errors.maxLength"))
      .refine((val) => {
        const validFormats = ["pdf", "facturx", "zugferd", "xrechnung", "ubl", "cii"]
        return validFormats.includes(val.toLowerCase())
      }, t("settings.company.form.invoicePDFFormat.errors.format")),
    dateFormat: z
      .string()
      .min(1, t("settings.company.form.dateFormat.errors.required"))
      .max(50, t("settings.company.form.dateFormat.errors.maxLength"))
      .refine((val) => {
        return ALLOWED_DATE_FORMATS.includes(val)
      }, t("settings.company.form.dateFormat.errors.format")),
    exemptVat: z.boolean().optional(),
  })

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      description: "",
      legalId: "",
      VAT: "",
      exemptVat: false,
      foundedAt: new Date(),
      currency: "",
      address: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      country: "",
      phone: "",
      email: "",
      invoicePDFFormat: "pdf",
      dateFormat: "dd/MM/yyyy",
      quoteStartingNumber: 1,
      quoteNumberFormat: "Q-{year}-{number}",
      invoiceStartingNumber: 1,
      invoiceNumberFormat: "INV-{year}-{number}",
      receiptStartingNumber: 1,
      receiptNumberFormat: "REC-{year}-{number}",
    },
  })

  async function onSubmit(values: z.infer<typeof companySchema>) {
    // Ne soumettre que si on est à la dernière étape
    if (currentStepIndex !== STEPS.length - 1) {
      return
    }
    
    setIsLoading(true)
    try {
      // First create the company with basic info
      const company = await createCompany({ name: values.name });
      
      // Then update all company info
      await updateCompanyInfo(values);
      
      toast.success(t("settings.company.messages.updateSuccess"))
      // Fermer la modal après succès
      setIsOpen(false)
    } catch (error) {
      console.error("Error during onboarding:", error)
      toast.error(t("settings.company.messages.updateError"))
    } finally {
      setIsLoading(false)
    }
  }

  const getDateFormatOption = (dateFormat: string) => {
    return `${format(new Date(), dateFormat)} - (${dateFormat})`
  }

  const getStepFields = (stepIndex: number): (keyof z.infer<typeof companySchema>)[] => {
    switch (stepIndex) {
      case 0:
        return ["name", "description", "foundedAt", "currency", "legalId", "VAT"]
      case 1:
        return ["address", "addressLine2", "postalCode", "city", "country"]
      case 2:
        return ["phone", "email"]
      case 3:
        return [
          "quoteStartingNumber",
          "quoteNumberFormat",
          "invoiceStartingNumber",
          "invoiceNumberFormat",
          "receiptStartingNumber",
          "receiptNumberFormat",
          "invoicePDFFormat",
          "dateFormat",
        ]
      default:
        return []
    }
  }

  const loading = isLoading || externalLoading

  return (
    <Dialog open={isOpen}>
      <DialogContent className="!max-w-[50vw] max-h-[90vh] overflow-y-auto p-8" showCloseButton={false} data-cy="onboarding-dialog">
        <DialogHeader>
          <DialogTitle>{t("settings.company.title")}</DialogTitle>
          <DialogDescription>{t("settings.company.description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <StepIndicator steps={STEPS} currentStep={currentStepIndex} completedSteps={completedSteps} />

            {/* Basic Info Step */}
            {currentStepIndex === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{STEPS[0].label}</CardTitle>
                  <CardDescription>{t("settings.company.basicInfoDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("settings.company.form.description.label")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.company.form.description.placeholder")} {...field} data-cy="onboarding-company-description-input" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.description.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="foundedAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.foundedAt.label")}</FormLabel>
                          <FormControl>
                            <DatePicker
                              className="w-full bg-opacity-100"
                              value={field.value || null}
                              onChange={field.onChange}
                              placeholder={t("settings.company.form.foundedAt.placeholder")}
                              data-cy="onboarding-company-foundedat-input"
                            />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.foundedAt.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.currency.label")}</FormLabel>
                          <FormControl>
                            <CurrencySelect value={field.value} onChange={(value) => field.onChange(value)} data-cy="onboarding-company-currency-select" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.currency.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="legalId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("settings.company.form.legalId.label")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.company.form.legalId.placeholder")} {...field} data-cy="onboarding-company-legalid-input" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.legalId.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="VAT"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("settings.company.form.vat.label")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.company.form.vat.placeholder")} {...field} data-cy="onboarding-company-vat-input" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.vat.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Address Step */}
            {currentStepIndex === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>{STEPS[1].label}</CardTitle>
                  <CardDescription>{t("settings.company.address.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("settings.company.form.address.label")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("settings.company.form.address.placeholder")} {...field} data-cy="onboarding-company-address-input" />
                        </FormControl>
                        <FormDescription>{t("settings.company.form.address.description")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="addressLine2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.company.form.addressLine2.label")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("settings.company.form.addressLine2.placeholder")} {...field} data-cy="onboarding-company-addressline2-input" />
                        </FormControl>
                        <FormDescription>{t("settings.company.form.addressLine2.description")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField
                      control={form.control}
                      name="postalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.postalCode.label")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.company.form.postalCode.placeholder")} {...field} data-cy="onboarding-company-postalcode-input" />
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
                          <FormLabel required>{t("settings.company.form.city.label")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.company.form.city.placeholder")} {...field} data-cy="onboarding-company-city-input" />
                          </FormControl>
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
                            <Input placeholder={t("settings.company.form.country.placeholder")} {...field} data-cy="onboarding-company-country-input" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Contact Step */}
            {currentStepIndex === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>{STEPS[2].label}</CardTitle>
                  <CardDescription>{t("settings.company.contact.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.phone.label")}</FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder={t("settings.company.form.phone.placeholder")} {...field} data-cy="onboarding-company-phone-input" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.phone.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.email.label")}</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder={t("settings.company.form.email.placeholder")} {...field} data-cy="onboarding-company-email-input" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.email.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Settings Step */}
            {currentStepIndex === 3 && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{STEPS[3].label}</CardTitle>
                    <CardDescription>{t("settings.company.numbering.description")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="quoteStartingNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.quoteStartingNumber.label")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder={t("settings.company.form.quoteStartingNumber.placeholder")}
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                data-cy="onboarding-company-quote-starting-number-input"
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings.company.form.quoteStartingNumber.description")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="quoteNumberFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.quoteNumberFormat.label")}</FormLabel>
                            <FormControl>
                              <Input placeholder={t("settings.company.form.quoteNumberFormat.placeholder")} {...field} data-cy="onboarding-company-quote-number-format-input" />
                            </FormControl>
                            <FormDescription>{t("settings.company.form.quoteNumberFormat.description")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="invoiceStartingNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.invoiceStartingNumber.label")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder={t("settings.company.form.invoiceStartingNumber.placeholder")}
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                data-cy="onboarding-company-invoice-starting-number-input"
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings.company.form.invoiceStartingNumber.description")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="invoiceNumberFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.invoiceNumberFormat.label")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t("settings.company.form.invoiceNumberFormat.placeholder")}
                                {...field}
                                data-cy="onboarding-company-invoice-number-format-input"
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings.company.form.invoiceNumberFormat.description")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="receiptStartingNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.receiptStartingNumber.label")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder={t("settings.company.form.receiptStartingNumber.placeholder")}
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                data-cy="onboarding-company-receipt-starting-number-input"
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings.company.form.receiptStartingNumber.description")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="receiptNumberFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t("settings.company.form.receiptNumberFormat.label")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t("settings.company.form.receiptNumberFormat.placeholder")}
                                {...field}
                                data-cy="onboarding-company-receipt-number-format-input"
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings.company.form.receiptNumberFormat.description")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("settings.company.other.title")}</CardTitle>
                    <CardDescription>{t("settings.company.other.description")}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="invoicePDFFormat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.invoicePDFFormat.label")}</FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="w-full" data-cy="onboarding-company-pdfformat-select">
                                <SelectValue placeholder={t("settings.company.form.invoicePDFFormat.placeholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pdf" data-cy="onboarding-company-pdfformat-option-pdf">
                                  {t("settings.company.form.invoicePDFFormat.options.pdf")}
                                </SelectItem>
                                <SelectItem value="facturx" data-cy="onboarding-company-pdfformat-option-facturx">
                                  {t("settings.company.form.invoicePDFFormat.options.facturx")}
                                </SelectItem>
                                <SelectItem value="zugferd" data-cy="onboarding-company-pdfformat-option-zugferd">
                                  {t("settings.company.form.invoicePDFFormat.options.zugferd")}
                                </SelectItem>
                                <SelectItem value="xrechnung" data-cy="onboarding-company-pdfformat-option-xrechnung">
                                  {t("settings.company.form.invoicePDFFormat.options.xrechnung")}
                                </SelectItem>
                                <SelectItem value="ubl" data-cy="onboarding-company-pdfformat-option-ubl">
                                  {t("settings.company.form.invoicePDFFormat.options.ubl")}
                                </SelectItem>
                                <SelectItem value="cii" data-cy="onboarding-company-pdfformat-option-cii">
                                  {t("settings.company.form.invoicePDFFormat.options.cii")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>{t("settings.company.form.invoicePDFFormat.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="dateFormat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("settings.company.form.dateFormat.label")}</FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="w-full" data-cy="onboarding-company-dateformat-select">
                                <SelectValue placeholder={t("settings.company.form.dateFormat.placeholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {ALLOWED_DATE_FORMATS.map((format) => (
                                  <SelectItem key={format} value={format} data-cy={`onboarding-company-dateformat-option-${format}`}>
                                    {getDateFormatOption(format)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>{t("settings.company.form.dateFormat.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="exemptVat"
                      render={({ field }) => (
                        <FormItem className="flex flex-col space-y-3">
                          <FormLabel>{t("settings.company.form.exemptVat.label")}</FormLabel>
                          <FormControl>
                            <Switch checked={!!field.value} onCheckedChange={(val) => field.onChange(val)} data-cy="onboarding-company-exemptvat-switch" />
                          </FormControl>
                          <FormDescription>{t("settings.company.form.exemptVat.description")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </>
            )}

            <div className="flex justify-between gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={currentStepIndex === 0 || loading}
                onClick={() => {
                  setCurrentStepIndex(currentStepIndex - 1)
                }}
                data-cy="onboarding-prev-btn"
              >
                {t("common.previous")}
              </Button>

              {currentStepIndex < STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault()
                    const stepFields = getStepFields(currentStepIndex)
                    const isValid = await form.trigger(stepFields)
                    if (isValid) {
                      setCompletedSteps([...completedSteps, currentStepIndex])
                      setCurrentStepIndex(currentStepIndex + 1)
                    }
                  }}
                  disabled={loading}
                  data-cy="onboarding-next-btn"
                >
                  {t("common.next")}
                </Button>
              ) : (
                <Button type="submit" disabled={loading} data-cy="onboarding-submit-btn">
                  {loading ? t("common.loading") : t("common.finish")}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

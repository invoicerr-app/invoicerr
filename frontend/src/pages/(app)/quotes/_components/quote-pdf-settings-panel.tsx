"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { useGet, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type React from "react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { TemplateSettings } from "../../settings/_components/pdf.settings"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

const LABEL_FIELDS: { key: keyof TemplateSettings["labels"]; i18nKey: string }[] = [
  { key: "quote", i18nKey: "quote" },
  { key: "quoteFor", i18nKey: "quoteFor" },
  { key: "legalId", i18nKey: "legalId" },
  { key: "VATId", i18nKey: "vatId" },
  { key: "validUntil", i18nKey: "validUntil" },
  { key: "date", i18nKey: "date" },
  { key: "description", i18nKey: "description" },
  { key: "quantity", i18nKey: "quantity" },
  { key: "unitPrice", i18nKey: "unitPrice" },
  { key: "vatRate", i18nKey: "vatRate" },
  { key: "type", i18nKey: "type" },
  { key: "hour", i18nKey: "hour" },
  { key: "day", i18nKey: "day" },
  { key: "deposit", i18nKey: "deposit" },
  { key: "service", i18nKey: "service" },
  { key: "product", i18nKey: "product" },
  { key: "subtotal", i18nKey: "subtotal" },
  { key: "discount", i18nKey: "discount" },
  { key: "vat", i18nKey: "vat" },
  { key: "grandTotal", i18nKey: "grandTotal" },
  { key: "notes", i18nKey: "notes" },
  { key: "paymentMethod", i18nKey: "paymentMethod" },
  { key: "paymentDetails", i18nKey: "paymentDetails" },
  { key: "paymentMethodBankTransfer", i18nKey: "paymentMethodBankTransfer" },
  { key: "paymentMethodPayPal", i18nKey: "paymentMethodPayPal" },
  { key: "paymentMethodCash", i18nKey: "paymentMethodCash" },
  { key: "paymentMethodCheck", i18nKey: "paymentMethodCheck" },
  { key: "paymentMethodOther", i18nKey: "paymentMethodOther" },
]

interface QuotePdfSettingsPanelProps {
  settings: TemplateSettings | null
  onSettingsChange: (settings: TemplateSettings) => void
  onSaved?: () => void
}

/** Curated, quote-relevant subset of the company-wide PDF template settings. Reads/writes the same `/api/company/pdf-template` config used by Settings > PDF templates — changes here apply to every document, not just this quote. */
export function QuotePdfSettingsPanel({ settings, onSettingsChange, onSaved }: QuotePdfSettingsPanelProps) {
  const { t } = useTranslation()
  const { data: companySettings } = useGet<TemplateSettings>("/api/company/pdf-template")
  const { trigger: saveSettings, loading: saving } = usePost<TemplateSettings>("/api/company/pdf-template")
  const seeded = useRef(false)

  useEffect(() => {
    if (companySettings && !seeded.current) {
      seeded.current = true
      onSettingsChange(companySettings)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySettings])

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const updateField = <K extends keyof TemplateSettings>(key: K, value: TemplateSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value })
  }

  const updateLabel = (key: keyof TemplateSettings["labels"], value: string) => {
    onSettingsChange({ ...settings, labels: { ...settings.labels, [key]: value } })
  }

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      onSettingsChange({ ...settings, logoB64: reader.result as string, includeLogo: true })
    }
    reader.readAsDataURL(file)
  }

  const removeLogo = () => {
    onSettingsChange({ ...settings, logoB64: "", includeLogo: false })
  }

  const handleSave = () => {
    saveSettings(settings)
      .then(() => {
        toast.success(t("settings.pdfTemplates.messages.updateSuccess"))
        onSaved?.()
      })
      .catch((error) => {
        console.error("Error updating template settings:", error)
        toast.error(t("settings.pdfTemplates.messages.updateError"))
      })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto pr-4">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pdfTemplates.typography.title")}</CardTitle>
              <CardDescription>{t("settings.pdfTemplates.typography.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>{t("settings.pdfTemplates.typography.fontFamily")}</Label>
                <Select
                  value={settings.fontFamily}
                  onValueChange={(value) => updateField("fontFamily", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Arial">Arial</SelectItem>
                    <SelectItem value="Times New Roman">Times New Roman</SelectItem>
                    <SelectItem value="Courier New">Courier New</SelectItem>
                    <SelectItem value="Helvetica">Helvetica</SelectItem>
                    <SelectItem value="Georgia">Georgia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pdfTemplates.logo.title")}</CardTitle>
              <CardDescription>{t("settings.pdfTemplates.logo.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("settings.pdfTemplates.logo.color")}</Label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={settings.secondaryColor}
                    onChange={(e) => updateField("secondaryColor", e.target.value)}
                    className="w-12 h-10 rounded border border-input"
                  />
                  <Input
                    value={settings.secondaryColor}
                    onChange={(e) => updateField("secondaryColor", e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.includeLogo}
                  onCheckedChange={(checked) => updateField("includeLogo", checked)}
                />
                <Label>{t("settings.pdfTemplates.logo.includeLogo")}</Label>
              </div>
              {settings.includeLogo && (
                <div className="space-y-4">
                  {settings.logoB64 ? (
                    <div className="relative inline-block">
                      <img
                        src={settings.logoB64 || "/placeholder.svg"}
                        alt={t("settings.pdfTemplates.logo.logoPreview")}
                        className="max-h-20 max-w-40 border border-border rounded"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                        onClick={removeLogo}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                      <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                      <Label htmlFor="quote-logo-upload" className="cursor-pointer">
                        <span className="text-sm text-muted-foreground">
                          {t("settings.pdfTemplates.logo.uploadText")}
                        </span>
                        <Input
                          id="quote-logo-upload"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                      </Label>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pdfTemplates.spacing.title")}</CardTitle>
              <CardDescription>{t("settings.pdfTemplates.spacing.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>
                  {t("settings.pdfTemplates.spacing.padding")}: {settings.padding}px
                </Label>
                <Slider
                  value={[settings.padding]}
                  onValueChange={(value) => updateField("padding", value[0])}
                  max={80}
                  min={20}
                  step={10}
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pdfTemplates.title")}</CardTitle>
              <CardDescription>{t("settings.pdfTemplates.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                {LABEL_FIELDS.map(({ key, i18nKey }) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={`quote-label-${key}`}>
                      {t(`settings.pdfTemplates.labels.${i18nKey}`)}
                    </Label>
                    <Input
                      id={`quote-label-${key}`}
                      value={settings.labels[key]}
                      onChange={(e) => updateLabel(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="shrink-0 pt-4">
        <Button onClick={handleSave} loading={saving} className="w-full">
          {t("quotes.pdf.edit.saveSettings")}
        </Button>
      </div>
    </div>
  )
}

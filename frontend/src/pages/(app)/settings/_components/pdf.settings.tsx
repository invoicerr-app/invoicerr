"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useGet, usePost } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import Handlebars from "handlebars"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type React from "react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { UnavailablePlatform } from "@/components/unavailable-platform"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

const defaultInvoiceTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{{labels.invoice}} {{number}}</title>
    <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: {{padding}}px; color: #333; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-info h1 { margin: 0; color: {{primaryColor}}; }
        .invoice-info { text-align: right; }
        .client-info { margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .notes { margin-top: 30px; padding: 20px; background-color: {{secondaryColor}}; border-radius: 4px; color: {{tableTextColor}}; }
        .payment-info { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid {{primaryColor}}; color: #333; }
        .logo { max-height: 80px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            {{#if includeLogo}}
            <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
            <h1>{{company.name}}</h1>
            <p>{{company.address}}<br>
            {{company.city}}, {{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}</br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="invoice-info">
            <h2>{{labels.invoice}}</h2>
            <p><strong>{{labels.invoice}}:</strong> #{{number}}<br>
            <strong>{{labels.date}}</strong> {{date}}<br>
            <strong>{{labels.dueDate}}</strong> {{dueDate}}</p>
        </div>
    </div>
    <div class="client-info">
        <h3>{{labels.billTo}}</h3>
        <p>{{client.name}}<br>
        {{client.address}}<br>
        {{client.city}}, {{client.postalCode}}<br>
        {{client.country}}<br>
        {{client.email}}</br>
        {{#if client.legalId}}<strong>{{labels.legalId}}:</strong> {{client.legalId}}<br>{{/if}}
        {{#if client.VAT}}<strong>{{labels.VATId}}:</strong> {{client.VAT}}{{/if}}</p>
    </div>
    <table>
        <thead>
            <tr>
                <th>{{labels.description}}</th>
                <th>{{labels.type}}</th>
                <th>{{labels.quantity}}</th>
                <th>{{labels.unitPrice}}</th>
                <th>{{labels.vatRate}}</th>
                <th>{{labels.total}}</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td>{{description}}</td>
                <td>{{type}}</td>
                <td>{{quantity}}</td>
                <td>{{../currency}} {{unitPrice}}</td>
                <td>{{vatRate}}%</td>
                <td>{{../currency}} {{totalPrice}}</td>
            </tr>
            {{/each}}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="5"><strong>{{labels.subtotal}}</strong></td>
                <td><strong>{{currency}} {{subtotalBeforeDiscount}}</strong></td>
            </tr>
            {{#if hasDiscount}}
            <tr>
                <td colspan="5"><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
                <td><strong>-{{currency}} {{discountAmount}}</strong></td>
            </tr>
            {{/if}}
            <tr>
                <td colspan="5"><strong>{{labels.total}}</strong></td>
                <td><strong>{{currency}} {{totalHT}}</strong></td>
            </tr>
            <tr>
                <td colspan="5"><strong>{{labels.vat}}</strong></td>
                <td><strong>{{currency}} {{totalVAT}}</strong></td>
            </tr>
            <tr class="total-row">
                <td colspan="5"><strong>{{labels.grandTotal}}</strong></td>
                <td><strong>{{currency}} {{totalTTC}}</strong></td>
            </tr>
        </tfoot>
    </table>

    {{#if paymentMethod}}
    <div class="payment-info">
        <strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}<br>
        {{#if paymentDetails}}
        <strong>{{labels.paymentDetails}}</strong> {{{paymentDetails}}}
        {{/if}}
    </div>
    {{/if}}
    
    {{#if noteExists}}
    <div class="notes">
        <h4>{{labels.notes}}</h4>
        <p>{{{notes}}}</p>
    </div>
    {{/if}}
</body>
</html>`

const defaultQuoteTemplate = `

<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Quote {{number}}</title>
    <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: {{padding}}px; color: #333; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-info h1 { margin: 0; color: {{primaryColor}}; }
        .quote-info { text-align: right; }
        .client-info { margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .notes { margin-top: 20px; padding: 20px; background-color: {{secondaryColor}}; border-radius: 4px; color: {{tableTextColor}}; }
        .payment-info { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid {{primaryColor}}; color: #333; }
        .validity { color: #dc2626; font-weight: bold; }
        .logo { max-height: 80px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            {{#if includeLogo}}
            <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
            <h1>{{company.name}}</h1>
            <p>{{company.address}}<br>
            {{company.city}}, {{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}</br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="quote-info">
            <h2>{{labels.quote}}</h2>
            <p><strong>{{labels.quote}}:</strong> #{{number}}<br>
            <strong>{{labels.date}}</strong> {{date}}<br>
            <strong class="validity">{{labels.validUntil}}</strong> {{validUntil}}</p>
        </div>
    </div>
    <div class="client-info">
        <h3>{{labels.quoteFor}}</h3>
        <p>{{client.name}}<br>
        {{client.address}}<br>
        {{client.city}}, {{client.postalCode}}<br>
        {{client.country}}<br>
        {{client.email}}</br>
        {{#if client.legalId}}<strong>{{labels.legalId}}:</strong> {{client.legalId}}<br>{{/if}}
        {{#if client.VAT}}<strong>{{labels.VATId}}:</strong> {{client.VAT}}{{/if}}</p>
    </div>
    <table>
        <thead>
            <tr>
                <th>{{labels.description}}</th>
                <th>{{labels.type}}</th>
                <th>{{labels.quantity}}</th>
                <th>{{labels.unitPrice}}</th>
                <th>{{labels.vatRate}}</th>
                <th>{{labels.total}}</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td>{{description}}</td>
                <td>{{type}}</td>
                <td>{{quantity}}</td>
                <td>{{../currency}} {{unitPrice}}</td>
                <td>{{vatRate}}%</td>
                <td>{{../currency}} {{totalPrice}}</td>
            </tr>
            {{/each}}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="5"><strong>{{labels.subtotal}}</strong></td>
                <td><strong>{{currency}} {{subtotalBeforeDiscount}}</strong></td>
            </tr>
            {{#if hasDiscount}}
            <tr>
                <td colspan="5"><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
                <td><strong>-{{currency}} {{discountAmount}}</strong></td>
            </tr>
            {{/if}}
            <tr>
                <td colspan="5"><strong>{{labels.total}}</strong></td>
                <td><strong>{{currency}} {{totalHT}}</strong></td>
            </tr>
            <tr>
                <td colspan="5"><strong>{{labels.vat}}</strong></td>
                <td><strong>{{currency}} {{totalVAT}}</strong></td>
            </tr>
            <tr class="total-row">
                <td colspan="5"><strong>{{labels.grandTotal}}</strong></td>
                <td><strong>{{currency}} {{totalTTC}}</strong></td>
            </tr>
        </tfoot>
    </table>
    
    {{#if paymentMethod}}
    <div class="payment-info">
        <strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}<br>
        {{#if paymentDetails}}
        <strong>{{labels.paymentDetails}}</strong> {{{paymentDetails}}}
        {{/if}}
    </div>
    {{/if}}
    
    {{#if noteExists}}
    <div class="notes">
        <h4>{{labels.notes}}</h4>
        <p>{{{notes}}}</p>
    </div>
    {{/if}}
</body>
</html>
`

const defaultReceiptTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{{labels.receipt}} {{number}}</title>
    <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: {{padding}}px; color: #333; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-info h1 { margin: 0; color: {{primaryColor}}; }
        .receipt-info { text-align: right; }
        .client-info { margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .notes { margin-top: 20px; padding: 20px; background-color: {{secondaryColor}}; border-radius: 4px; color: {{tableTextColor}}; }
        .payment-info { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid {{primaryColor}}; color: #333; }
        .logo { max-height: 80px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            {{#if includeLogo}}
            <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
            <h1>{{company.name}}</h1>
            <p>{{company.address}}<br>
            {{company.city}}, {{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}<br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="receipt-info">
            <h2>{{labels.receipt}}</h2>
            <p><strong>{{labels.receipt}}:</strong> #{{number}}<br>
            <strong>{{labels.paymentDate}}</strong> {{paymentDate}}<br>
            <strong>{{labels.invoiceRefer}}</strong> {{invoiceNumber}}</p>
        </div>
    </div>
    <div class="client-info">
        <h3>{{labels.receivedFrom}}</h3>
        <p>{{client.name}}<br>
        {{#if client.description}}<strong>{{labels.description}}</strong> {{client.description}}<br>{{/if}}
        {{client.address}}<br>
        {{client.city}}, {{client.postalCode}}<br>
        {{client.country}}<br>
        {{client.email}}</p>
    </div>
    <table>
        <thead>
            <tr>
                <th>{{labels.description}}</th>
                <th>{{labels.type}}</th>
                <th>{{labels.totalReceived}}</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td>{{description}}</td>
                <td>{{type}}</td>
                <td>{{../currency}} {{amount}}</td>
            </tr>
            {{/each}}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="2"><strong>{{labels.total}}</strong></td>
                <td><strong>{{currency}} {{totalBeforeDiscount}}</strong></td>
            </tr>
            {{#if hasDiscount}}
            <tr>
                <td colspan="2"><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
                <td><strong>-{{currency}} {{discountAmount}}</strong></td>
            </tr>
            {{/if}}
            <tr class="total-row">
                <td colspan="2"><strong>{{labels.totalReceived}}</strong></td>
                <td><strong>{{currency}} {{totalAmount}}</strong></td>
            </tr>
        </tfoot>
    </table>

    {{#if paymentMethod}}
    <div class="payment-info">
        <strong>{{labels.paymentMethod}}</strong> {{paymentMethod}}<br>
        {{#if paymentDetails}}
        <strong>{{labels.paymentDetails}}</strong> {{{paymentDetails}}}
        {{/if}}
    </div>
    {{/if}}
    
    {{#if noteExists}}
    <div class="notes">
        <h4>{{labels.notes}}</h4>
        <p>{{{notes}}}</p>
    </div>
    {{/if}}
</body>
</html>
`
interface TemplateSettings {
    templateType: "invoice" | "quote" | "receipt"
    fontFamily: string
    primaryColor: string
    secondaryColor: string
    includeLogo: boolean
    logoB64: string
    labels: {
        invoice: string
        quote: string
        billTo: string
        quoteFor: string
        validUntil: string
        date: string
        dueDate: string
        description: string
        quantity: string
        unitPrice: string
        total: string
        subtotal: string
        discount: string
        vat: string
        grandTotal: string
        vatRate: string
        notes: string
        paymentMethod: string
        paymentDetails: string
        legalId: string
        VATId: string
        hour: string
        day: string
        deposit: string
        service: string
        product: string
        type: string

        // Receipt-specific labels
        receipt: string
        receivedFrom: string
        invoiceRefer: string
        paymentDate: string
        totalReceived: string

        // Payment method labels (configurable in settings)
        paymentMethodBankTransfer: string
        paymentMethodPayPal: string
        paymentMethodCash: string
        paymentMethodCheck: string
        paymentMethodOther: string
    }
    padding: number
}

export default function PDFTemplatesSettings() {
    const { t } = useTranslation()
    const { data: companyTemplateSettings } = useGet<TemplateSettings>("/api/company/pdf-template")
    const { trigger: updateTemplateSettings, loading: updateTemplateSettingsLoading } =
        usePost<TemplateSettings>("/api/company/pdf-template")

    function getInvertColor(hex: string): string {
        let cleanHex = hex.replace(/^#/, '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(c => c + c).join('');
        }

        const r = parseInt(cleanHex.slice(0, 2), 16);
        const g = parseInt(cleanHex.slice(2, 4), 16);
        const b = parseInt(cleanHex.slice(4, 6), 16);

        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        return luminance > 186 ? '#000000' : '#ffffff';
    }

    const [settings, setSettings] = useState<TemplateSettings>({
        templateType: "invoice",
        fontFamily: "Arial",
        primaryColor: "#2563eb",
        secondaryColor: "#64748b",
        includeLogo: false,
        logoB64: "",
        labels: {
            invoice: t("settings.pdfTemplates.defaultLabels.invoice"),
            quote: t("settings.pdfTemplates.defaultLabels.quote"),
            billTo: t("settings.pdfTemplates.defaultLabels.billTo"),
            quoteFor: t("settings.pdfTemplates.defaultLabels.quoteFor"),
            validUntil: t("settings.pdfTemplates.defaultLabels.validUntil"),
            date: t("settings.pdfTemplates.defaultLabels.date"),
            dueDate: t("settings.pdfTemplates.defaultLabels.dueDate"),
            description: t("settings.pdfTemplates.defaultLabels.description"),
            quantity: t("settings.pdfTemplates.defaultLabels.quantity"),
            unitPrice: t("settings.pdfTemplates.defaultLabels.unitPrice"),
            total: t("settings.pdfTemplates.defaultLabels.total"),
            subtotal: t("settings.pdfTemplates.defaultLabels.subtotal"),
            discount: t("settings.pdfTemplates.defaultLabels.discount"),
            vat: t("settings.pdfTemplates.defaultLabels.vat"),
            grandTotal: t("settings.pdfTemplates.defaultLabels.grandTotal"),
            vatRate: t("settings.pdfTemplates.defaultLabels.vatRate"),
            notes: t("settings.pdfTemplates.defaultLabels.notes"),
            paymentMethod: t("settings.pdfTemplates.defaultLabels.paymentMethod"),
            paymentDetails: t("settings.pdfTemplates.defaultLabels.paymentDetails"),
            // new payment method labels
            paymentMethodBankTransfer: t("settings.pdfTemplates.defaultLabels.paymentMethodBankTransfer"),
            paymentMethodPayPal: t("settings.pdfTemplates.defaultLabels.paymentMethodPayPal"),
            paymentMethodCash: t("settings.pdfTemplates.defaultLabels.paymentMethodCash"),
            paymentMethodCheck: t("settings.pdfTemplates.defaultLabels.paymentMethodCheck"),
            paymentMethodOther: t("settings.pdfTemplates.defaultLabels.paymentMethodOther"),

            legalId: t("settings.pdfTemplates.defaultLabels.legalId"),
            VATId: t("settings.pdfTemplates.defaultLabels.VATId"),
            hour: t("settings.pdfTemplates.defaultLabels.hour"),
            day: t("settings.pdfTemplates.defaultLabels.day"),
            deposit: t("settings.pdfTemplates.defaultLabels.deposit"),
            service: t("settings.pdfTemplates.defaultLabels.service"),
            product: t("settings.pdfTemplates.defaultLabels.product"),
            type: t("settings.pdfTemplates.defaultLabels.type"),

            // Receipt defaults
            receipt: t("settings.pdfTemplates.defaultLabels.receipt"),
            receivedFrom: t("settings.pdfTemplates.defaultLabels.receivedFrom"),
            invoiceRefer: t("settings.pdfTemplates.defaultLabels.invoiceRefer"),
            paymentDate: t("settings.pdfTemplates.defaultLabels.paymentDate"),
            totalReceived: t("settings.pdfTemplates.defaultLabels.totalReceived"),
        },
        padding: 40,
    })

    useEffect(() => {
        if (companyTemplateSettings) {
            setSettings((prev) => ({
                ...companyTemplateSettings,
                templateType: prev.templateType, // preserve current templateType
            }))
        }
    }, [companyTemplateSettings])

    const [isResizing, setIsResizing] = useState(false)
    const [iframeKey, setIframeKey] = useState(0)

    const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onloadend = () => {
                setSettings((prev) => ({
                    ...prev,
                    logoB64: reader.result as string,
                    includeLogo: true,
                }))
                setIframeKey((prev) => prev + 1) // Force re-render of iframe
            }
            reader.readAsDataURL(file)
        }
    }

    const removeLogo = () => {
        setSettings((prev) => ({
            ...prev,
            logoB64: "",
            includeLogo: false,
        }))
    }

    const updateLabel = (key: keyof typeof settings.labels, value: string) => {
        setSettings((prev) => ({
            ...prev,
            labels: {
                ...prev.labels,
                [key]: value,
            },
        }))
    }

    const sampleData = useMemo(
        () => ({
            company: {
                name: "Acme Corporation",
                address: "123 Business Street",
                city: "New York",
                postalCode: "10001",
                country: "USA",
                email: "contact@acme.com",
                phone: "+1 234 567 890",
                legalId: "123456789",
                VAT: "US123456789",
            },
            client: {
                name: "John Doe",
                address: "456 Client Avenue",
                city: "Los Angeles",
                postalCode: "90001",
                country: "USA",
                email: "john.doe@acme.com",
                phone: "+1 987 654 321",
                legalId: "987654321",
                VAT: "US987654321",
            },
            number: settings.templateType === "invoice" ? "INV-2024-001" : settings.templateType === "quote" ? "QUO-2024-001" : "REC-2024-001",
            date: new Date().toLocaleDateString("en-US"),
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US"),
            validUntil: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US"),
            paymentDate: new Date().toLocaleDateString("en-US"),
            invoiceNumber: "0001",
            paymentMethod: "Bank Transfer",
            paymentDetails: "Bank: Acme Bank, Account: 123456789, SWIFT: ACMEUS33",
            noteExists: true,
            notes: "Thank you for your business! If you have any questions, feel free to contact us.",
            items: [
                {
                    description: "Web Development",
                    type: "Hour",
                    quantity: "40",
                    unitPrice: "75.00",
                    vatRate: "20",
                    totalPrice: "3600.00",
                },
                {
                    description: "Consulting Services",
                    type: "Service",
                    quantity: "10",
                    unitPrice: "100.00",
                    vatRate: "20",
                    totalPrice: "1200.00",
                },
            ],
            subtotalBeforeDiscount: "4000.00",
            discountRate: 10,
            discountAmount: "400.00",
            totalHT: "3600.00",
            totalVAT: "720.00",
            totalTTC: "4320.00",
            totalBeforeDiscount: "4800.00",
            hasDiscount: true,
            currency: "EUR",
            fontFamily: settings.fontFamily,
            primaryColor: settings.primaryColor,
            secondaryColor: settings.secondaryColor,
            tableTextColor: getInvertColor(settings.secondaryColor),
            padding: settings.padding,
            includeLogo: settings.includeLogo,
            logoB64: settings.logoB64,
            labels: settings.labels,
        }),
        [settings],
    )

    const generatePreviewHTML = useMemo(() => {
        const template =
            settings.templateType === "invoice"
                ? defaultInvoiceTemplate
                : settings.templateType === "quote"
                    ? defaultQuoteTemplate
                    : defaultReceiptTemplate
        const compiledTemplate = Handlebars.compile(template)
        return compiledTemplate(sampleData)
    }, [settings, sampleData])

    const handleSaveSettings = () => {
        updateTemplateSettings(settings)
            .then(() => {
                toast.success(t("settings.pdfTemplates.messages.updateSuccess"))
            })
            .catch((error) => {
                console.error("Error updating template settings:", error)
                toast.error(t("settings.pdfTemplates.messages.updateError"))
            })
    }

    return (
        <div>
            <div className="mb-4">
                <h1 className="text-3xl font-bold">{t("settings.pdfTemplates.title")}</h1>
                <p className="text-muted-foreground">{t("settings.pdfTemplates.description")}</p>
            </div>

            <div className="lg:hidden">
                <UnavailablePlatform />
            </div>

            <div className="hidden lg:block flex-1 min-h-0">
                <ResizablePanelGroup direction="horizontal" className="!h-[calc(100dvh-18rem)]">
                    <ResizablePanel defaultSize={45} minSize={30} maxSize={70}>
                        <div className="h-full flex flex-col">
                            <div className="flex-1 overflow-y-auto pr-4">
                                <div className="space-y-6">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>{t("settings.pdfTemplates.templateType.title")}</CardTitle>
                                            <CardDescription>{t("settings.pdfTemplates.templateType.description")}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                <Label htmlFor="template-type">{t("settings.pdfTemplates.templateType.label")}</Label>
                                                <Select
                                                    value={settings.templateType}
                                                    onValueChange={(value: "invoice" | "quote" | "receipt") =>
                                                        setSettings((prev) => ({ ...prev, templateType: value }))
                                                    }
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="invoice">
                                                            {t("settings.pdfTemplates.templateType.options.invoice")}
                                                        </SelectItem>
                                                        <SelectItem value="quote">
                                                            {t("settings.pdfTemplates.templateType.options.quote")}
                                                        </SelectItem>
                                                        <SelectItem value="receipt">
                                                            {t("settings.pdfTemplates.templateType.options.receipt")}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle>{t("settings.pdfTemplates.typography.title")}</CardTitle>
                                            <CardDescription>{t("settings.pdfTemplates.typography.description")}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                <Label htmlFor="font-family">{t("settings.pdfTemplates.typography.fontFamily")}</Label>
                                                <Select
                                                    value={settings.fontFamily}
                                                    onValueChange={(value) => setSettings((prev) => ({ ...prev, fontFamily: value }))}
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
                                            <CardTitle>{t("settings.pdfTemplates.colors.title")}</CardTitle>
                                            <CardDescription>{t("settings.pdfTemplates.colors.description")}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="primary-color">{t("settings.pdfTemplates.colors.primaryColor")}</Label>
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="color"
                                                        id="primary-color"
                                                        value={settings.primaryColor}
                                                        onChange={(e) => setSettings((prev) => ({ ...prev, primaryColor: e.target.value }))}
                                                        className="w-12 h-10 rounded border border-input"
                                                    />
                                                    <Input
                                                        value={settings.primaryColor}
                                                        onChange={(e) => setSettings((prev) => ({ ...prev, primaryColor: e.target.value }))}
                                                        className="flex-1"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="primary-color">{t("settings.pdfTemplates.colors.secondaryColor")}</Label>
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="color"
                                                        id="primary-color"
                                                        value={settings.secondaryColor}
                                                        onChange={(e) => setSettings((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                                                        className="w-12 h-10 rounded border border-input"
                                                    />
                                                    <Input
                                                        value={settings.secondaryColor}
                                                        onChange={(e) => setSettings((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                                                        className="flex-1"
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle>{t("settings.pdfTemplates.logo.title")}</CardTitle>
                                            <CardDescription>{t("settings.pdfTemplates.logo.description")}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="include-logo"
                                                    checked={settings.includeLogo}
                                                    onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, includeLogo: checked }))}
                                                />
                                                <Label htmlFor="include-logo">{t("settings.pdfTemplates.logo.includeLogo")}</Label>
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
                                                            <Label htmlFor="logo-upload" className="cursor-pointer">
                                                                <span className="text-sm text-muted-foreground">
                                                                    {t("settings.pdfTemplates.logo.uploadText")}
                                                                </span>
                                                                <Input
                                                                    id="logo-upload"
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
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>
                                                        {t("settings.pdfTemplates.spacing.padding")}: {settings.padding}px
                                                    </Label>
                                                    <Slider
                                                        value={[settings.padding]}
                                                        onValueChange={(value) => setSettings((prev) => ({ ...prev, padding: value[0] }))}
                                                        max={80}
                                                        min={20}
                                                        step={10}
                                                        className="w-full"
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle>{t("settings.pdfTemplates.title")}</CardTitle>
                                            <CardDescription>{t("settings.pdfTemplates.description")}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid grid-cols-1 gap-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-invoice">{t("settings.pdfTemplates.labels.invoice")}</Label>
                                                    <Input
                                                        id="label-invoice"
                                                        value={settings.labels.invoice}
                                                        onChange={(e) => updateLabel("invoice", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-quote">{t("settings.pdfTemplates.labels.quote")}</Label>
                                                    <Input
                                                        id="label-quote"
                                                        value={settings.labels.quote}
                                                        onChange={(e) => updateLabel("quote", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-legal-id">{t("settings.pdfTemplates.labels.legalId")}</Label>
                                                    <Input
                                                        id="label-legal-id"
                                                        value={settings.labels.legalId}
                                                        onChange={(e) => updateLabel("legalId", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-vat-id">{t("settings.pdfTemplates.labels.vatId")}</Label>
                                                    <Input
                                                        id="label-vat-id"
                                                        value={settings.labels.VATId}
                                                        onChange={(e) => updateLabel("VATId", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-bill-to">{t("settings.pdfTemplates.labels.billTo")}</Label>
                                                    <Input
                                                        id="label-bill-to"
                                                        value={settings.labels.billTo}
                                                        onChange={(e) => updateLabel("billTo", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-quote-for">{t("settings.pdfTemplates.labels.quoteFor")}</Label>
                                                    <Input
                                                        id="label-quote-for"
                                                        value={settings.labels.quoteFor}
                                                        onChange={(e) => updateLabel("quoteFor", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-valid-until">{t("settings.pdfTemplates.labels.validUntil")}</Label>
                                                    <Input
                                                        id="label-valid-until"
                                                        value={settings.labels.validUntil}
                                                        onChange={(e) => updateLabel("validUntil", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-due-date">{t("settings.pdfTemplates.labels.dueDate")}</Label>
                                                    <Input
                                                        id="label-due-date"
                                                        value={settings.labels.dueDate}
                                                        onChange={(e) => updateLabel("dueDate", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-date">{t("settings.pdfTemplates.labels.date")}</Label>
                                                    <Input
                                                        id="label-date"
                                                        value={settings.labels.date}
                                                        onChange={(e) => updateLabel("date", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-description">{t("settings.pdfTemplates.labels.description")}</Label>
                                                    <Input
                                                        id="label-description"
                                                        value={settings.labels.description}
                                                        onChange={(e) => updateLabel("description", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-quantity">{t("settings.pdfTemplates.labels.quantity")}</Label>
                                                    <Input
                                                        id="label-quantity"
                                                        value={settings.labels.quantity}
                                                        onChange={(e) => updateLabel("quantity", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-unit-price">{t("settings.pdfTemplates.labels.unitPrice")}</Label>
                                                    <Input
                                                        id="label-unit-price"
                                                        value={settings.labels.unitPrice}
                                                        onChange={(e) => updateLabel("unitPrice", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-total">{t("settings.pdfTemplates.labels.total")}</Label>
                                                    <Input
                                                        id="label-total"
                                                        value={settings.labels.total}
                                                        onChange={(e) => updateLabel("total", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-subtotal">{t("settings.pdfTemplates.labels.subtotal")}</Label>
                                                    <Input
                                                        id="label-subtotal"
                                                        value={settings.labels.subtotal}
                                                        onChange={(e) => updateLabel("subtotal", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-discount">{t("settings.pdfTemplates.labels.discount")}</Label>
                                                    <Input
                                                        id="label-discount"
                                                        value={settings.labels.discount}
                                                        onChange={(e) => updateLabel("discount", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-vat">{t("settings.pdfTemplates.labels.vat")}</Label>
                                                    <Input
                                                        id="label-vat"
                                                        value={settings.labels.vat}
                                                        onChange={(e) => updateLabel("vat", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-vat-rate">{t("settings.pdfTemplates.labels.vatRate")}</Label>
                                                    <Input
                                                        id="label-vat-rate"
                                                        value={settings.labels.vatRate}
                                                        onChange={(e) => updateLabel("vatRate", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-grand-total">{t("settings.pdfTemplates.labels.grandTotal")}</Label>
                                                    <Input
                                                        id="label-grand-total"
                                                        value={settings.labels.grandTotal}
                                                        onChange={(e) => updateLabel("grandTotal", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-payment-method">{t("settings.pdfTemplates.labels.paymentMethod")}</Label>
                                                    <Input
                                                        id="label-payment-method"
                                                        value={settings.labels.paymentMethod}
                                                        onChange={(e) => updateLabel("paymentMethod", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-payment-details">{t("settings.pdfTemplates.labels.paymentDetails")}</Label>
                                                    <Input
                                                        id="label-payment-details"
                                                        value={settings.labels.paymentDetails}
                                                        onChange={(e) => updateLabel("paymentDetails", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-notes">{t("settings.pdfTemplates.labels.notes")}</Label>
                                                    <Input
                                                        id="label-notes"
                                                        value={settings.labels.notes}
                                                        onChange={(e) => updateLabel("notes", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-type">{t("settings.pdfTemplates.labels.type")}</Label>
                                                    <Input
                                                        id="label-type"
                                                        value={settings.labels.type}
                                                        onChange={(e) => updateLabel("type", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-hour">{t("settings.pdfTemplates.labels.hour")}</Label>
                                                    <Input
                                                        id="label-hour"
                                                        value={settings.labels.hour}
                                                        onChange={(e) => updateLabel("hour", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-day">{t("settings.pdfTemplates.labels.day")}</Label>
                                                    <Input
                                                        id="label-day"
                                                        value={settings.labels.day}
                                                        onChange={(e) => updateLabel("day", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-deposit">{t("settings.pdfTemplates.labels.deposit")}</Label>
                                                    <Input
                                                        id="label-deposit"
                                                        value={settings.labels.deposit}
                                                        onChange={(e) => updateLabel("deposit", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-service">{t("settings.pdfTemplates.labels.service")}</Label>
                                                    <Input
                                                        id="label-service"
                                                        value={settings.labels.service}
                                                        onChange={(e) => updateLabel("service", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-product">{t("settings.pdfTemplates.labels.product")}</Label>
                                                    <Input
                                                        id="label-product"
                                                        value={settings.labels.product}
                                                        onChange={(e) => updateLabel("product", e.target.value)}
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <Label htmlFor="label-receipt">{t("settings.pdfTemplates.labels.receipt")}</Label>
                                                    <Input
                                                        id="label-receipt"
                                                        value={settings.labels.receipt}
                                                        onChange={(e) => updateLabel("receipt", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-received-from">{t("settings.pdfTemplates.labels.receivedFrom")}</Label>
                                                    <Input
                                                        id="label-received-from"
                                                        value={settings.labels.receivedFrom}
                                                        onChange={(e) => updateLabel("receivedFrom", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-invoice-refer">{t("settings.pdfTemplates.labels.invoiceRefer")}</Label>
                                                    <Input
                                                        id="label-invoice-refer"
                                                        value={settings.labels.invoiceRefer}
                                                        onChange={(e) => updateLabel("invoiceRefer", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-payment-date">{t("settings.pdfTemplates.labels.paymentDate")}</Label>
                                                    <Input
                                                        id="label-payment-date"
                                                        value={settings.labels.paymentDate}
                                                        onChange={(e) => updateLabel("paymentDate", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="label-total-received">{t("settings.pdfTemplates.labels.totalReceived")}</Label>
                                                    <Input
                                                        id="label-total-received"
                                                        value={settings.labels.totalReceived}
                                                        onChange={(e) => updateLabel("totalReceived", e.target.value)}
                                                    />
                                                </div>

                                                <div className="space-y-2 pt-4 border-t">
                                                    <h4 className="text-sm font-medium">{t("settings.pdfTemplates.labels.paymentMethodVariants")}</h4>
                                                    <div className="grid grid-cols-1 gap-2 mt-2">
                                                        <div className="space-y-2">
                                                            <Label htmlFor="label-payment-bank-transfer">{t("settings.pdfTemplates.labels.paymentMethodBankTransfer")}</Label>
                                                            <Input
                                                                id="label-payment-bank-transfer"
                                                                value={settings.labels.paymentMethodBankTransfer}
                                                                onChange={(e) => updateLabel("paymentMethodBankTransfer", e.target.value)}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="label-payment-paypal">{t("settings.pdfTemplates.labels.paymentMethodPayPal")}</Label>
                                                            <Input
                                                                id="label-payment-paypal"
                                                                value={settings.labels.paymentMethodPayPal}
                                                                onChange={(e) => updateLabel("paymentMethodPayPal", e.target.value)}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="label-payment-cash">{t("settings.pdfTemplates.labels.paymentMethodCash")}</Label>
                                                            <Input
                                                                id="label-payment-cash"
                                                                value={settings.labels.paymentMethodCash}
                                                                onChange={(e) => updateLabel("paymentMethodCash", e.target.value)}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="label-payment-check">{t("settings.pdfTemplates.labels.paymentMethodCheck")}</Label>
                                                            <Input
                                                                id="label-payment-check"
                                                                value={settings.labels.paymentMethodCheck}
                                                                onChange={(e) => updateLabel("paymentMethodCheck", e.target.value)}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="label-payment-other">{t("settings.pdfTemplates.labels.paymentMethodOther")}</Label>
                                                            <Input
                                                                id="label-payment-other"
                                                                value={settings.labels.paymentMethodOther}
                                                                onChange={(e) => updateLabel("paymentMethodOther", e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <div className="pb-6">
                                        <Button
                                            loading={updateTemplateSettingsLoading}
                                            size="lg"
                                            className="w-full"
                                            onClick={handleSaveSettings}
                                        >
                                            {t("settings.pdfTemplates.saveButton")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ResizablePanel>

                    <ResizableHandle
                        withHandle
                        onDragging={(isDragging) => {
                            setIsResizing(isDragging)
                            if (!isDragging) {
                                setIframeKey((prev) => prev + 1)
                            }
                        }}
                    />

                    <ResizablePanel defaultSize={55} minSize={30}>
                        <div className="h-full flex flex-col">
                            <div className="flex-shrink-0 p-6 pb-4 border-b">
                                <h3 className="text-lg font-semibold">{t("settings.pdfTemplates.preview.title")}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {t("settings.pdfTemplates.preview.description", {
                                        templateType: t(`settings.pdfTemplates.templateType.options.${settings.templateType}`),
                                    })}
                                </p>
                            </div>
                            <div className="flex-1 p-6 min-h-0 relative">
                                {isResizing && <div className="absolute inset-6 bg-transparent z-10 rounded-lg" />}
                                <iframe
                                    key={iframeKey}
                                    srcDoc={generatePreviewHTML}
                                    className="w-full h-full bg-white border border-border rounded-lg"
                                    title={t("settings.pdfTemplates.preview.iframeTitle")}
                                />
                            </div>
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    )
}

import Handlebars from "handlebars"
import { format } from "date-fns"
import type { PaymentMethod, Quote } from "@/types"
import type { TemplateSettings } from "../../settings/_components/pdf.settings"
import type { QuoteFormValues } from "./quote-form"
import { formatAmount } from "@/lib/utils"
import { getDraftWatermarkLabel } from "@/lib/watermark"
import { isVatApplicable } from "@/lib/vat"

/**
 * Frontend-only mirror of backend/src/modules/quotes/templates/base.template.ts, kept
 * in sync by hand. Needed because there's no backend endpoint to preview unsaved
 * edits — this lets the quote editor render an instant, no-round-trip live preview.
 * Any future change to the real backend template should be mirrored here too.
 */
export const quotePreviewTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{{labels.quote}} {{number}}</title>
    <style>
        body { font-family: {{fontFamily}}, sans-serif; margin: {{padding}}px; color: #333; font-size: 13px; }
        .header { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; row-gap: 10px; margin-bottom: 30px; }
        .quote-info { text-align: right; }
        .header p { margin: 0; line-height: 1.4; }
        .client-info { text-align: left; }
        .client-info h3 { margin: 0 0 4px; }
        .client-info .name, .company-info .name { margin: 0 0 4px; font-weight: bold; }
        .company-info .spacer { visibility: hidden; margin: 0 0 4px; }
        .item-description { display: block; font-size: 12px; color: #666; white-space: pre-line; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; vertical-align: top; border-bottom: 1px solid #ddd; overflow-wrap: break-word; word-break: break-word; }
        th { background-color: {{secondaryColor}}; font-weight: bold; color: {{tableTextColor}}; }
        .items-table { table-layout: fixed; }
        .items-table th:nth-child(1), .items-table td:nth-child(1) { width: 38%; }
        .items-table th:nth-child(2), .items-table td:nth-child(2) { width: 10%; }
        .items-table th:nth-child(3), .items-table td:nth-child(3) { width: 9%; }
        .items-table th:nth-child(4), .items-table td:nth-child(4) { width: 16%; }
        .items-table th:nth-child(5), .items-table td:nth-child(5) { width: 9%; }
        .items-table th:nth-child(6), .items-table td:nth-child(6) { width: 18%; }
        .items-table.no-vat th:nth-child(1), .items-table.no-vat td:nth-child(1) { width: 47%; }
        .items-table.no-vat th:nth-child(5), .items-table.no-vat td:nth-child(5) { width: 18%; }
        .total-row { font-weight: bold; background-color: {{secondaryColor}}; color: {{tableTextColor}}; }
        .totals-table { width: 100%; border-collapse: collapse; margin: 0 0 20px; page-break-inside: avoid; break-inside: avoid; }
        .totals-table td:last-child { text-align: right; }
        .notes { margin-top: 20px; padding: 20px; background-color: {{secondaryColor}}; border-radius: 4px; color: {{tableTextColor}}; page-break-inside: avoid; break-inside: avoid; }
        .payment-info { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid {{primaryColor}}; color: #333; }
        .validity { color: #dc2626; font-weight: bold; }
        .logo { max-height: 140px; margin-bottom: 10px; }
        .made-with {
            position: fixed;
            bottom: 10px;
            right: 10px;
            font-size: 9px;
            color: #999;
        }
        .watermark {
            position: fixed;
            top: 45%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 96px;
            font-weight: bold;
            color: #ff0000;
            opacity: 0.15;
            z-index: 1000;
            pointer-events: none;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    {{#if isDraft}}
    <div class="watermark">{{draftLabel}}</div>
    {{/if}}
    <div class="made-with">Made with Invoicerr</div>
    <div class="header">
        <div class="company-name">
            {{#if includeLogo}}
                <img src="{{logoB64}}" alt="Logo" class="logo">
            {{/if}}
        </div>
        <div class="quote-info">
            <h2>{{labels.quote}}</h2>
            <p><strong>{{labels.quote}}:</strong> #{{number}}<br>
            <strong>{{labels.date}}</strong> {{date}}<br>
            <strong class="validity">{{labels.validUntil}}</strong> {{validUntil}}</p>
        </div>
        <div class="company-info">
            <h3 class="spacer">{{labels.quoteFor}}</h3>
            <p class="name">{{company.name}}</p>
            {{#if company.description}}<strong>{{labels.description}}</strong> {{company.description}}<br>{{/if}}
            <p>{{company.address}}<br>
            {{#if company.addressLine2}}{{company.addressLine2}}<br>{{/if}}
            {{company.city}}, {{#if company.state}}{{company.state}} {{/if}}{{company.postalCode}}<br>
            {{company.country}}<br>
            {{company.email}} | {{company.phone}}<br>
            {{#if company.legalId}}<strong>{{labels.legalId}}:</strong> {{company.legalId}}<br>{{/if}}
            {{#if company.VAT}}<strong>{{labels.VATId}}:</strong> {{company.VAT}}{{/if}}</p>
        </div>
        <div class="client-info">
            <h3>{{labels.quoteFor}}</h3>
            <p class="name">{{client.name}}</p>
            {{#if client.description}}<strong>{{labels.description}}</strong> {{client.description}}<br>{{/if}}
            <p>{{client.address}}<br>
            {{#if client.addressLine2}}{{client.addressLine2}}<br>{{/if}}
            {{client.city}}, {{#if client.state}}{{client.state}} {{/if}}{{client.postalCode}}<br>
            {{client.country}}{{#if client.email}}<br>{{client.email}}{{/if}}
            {{#if client.legalId}}<br><strong>{{labels.legalId}}:</strong> {{client.legalId}}{{/if}}
            {{#if client.VAT}}<br><strong>{{labels.VATId}}:</strong> {{client.VAT}}{{/if}}</p>
        </div>
    </div>
    <table class="items-table{{#unless showVat}} no-vat{{/unless}}">
        <thead>
            <tr>
                <th>{{labels.description}}</th>
                <th>{{labels.type}}</th>
                <th>{{labels.quantity}}</th>
                <th>{{labels.unitPrice}}</th>
                {{#if showVat}}
                <th>{{labels.vatRate}}</th>
                {{/if}}
                <th>{{labels.total}}</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td><strong>{{name}}</strong>{{#if description}}<span class="item-description">{{{description}}}</span>{{/if}}</td>
                <td>{{type}}</td>
                <td>{{quantity}}</td>
                <td>{{../currency}} {{unitPrice}}</td>
                {{#if ../showVat}}
                <td>{{vatRate}}%</td>
                {{/if}}
                <td>{{../currency}} {{totalPrice}}</td>
            </tr>
            {{/each}}
        </tbody>
    </table>
    <table class="totals-table">
        <tbody>
            <tr>
                <td colspan="{{totalsColspan}}"><strong>{{labels.subtotal}}</strong></td>
                <td><strong>{{currency}} {{subtotalBeforeDiscount}}</strong></td>
            </tr>
            {{#if hasDiscount}}
            <tr>
                <td colspan="{{totalsColspan}}"><strong>{{labels.discount}} ({{discountRate}}%)</strong></td>
                <td><strong>-{{currency}} {{discountAmount}}</strong></td>
            </tr>
            {{/if}}
            {{#if showVat}}
            <tr>
                <td colspan="{{totalsColspan}}"><strong>{{labels.vat}}</strong></td>
                <td><strong>{{currency}} {{totalVAT}}</strong></td>
            </tr>
            {{/if}}
            {{#if vatExemptText}}
            <tr>
                <td></td>
                <td colspan="{{totalsColspan}}" style="font-size:12px; color:#666; text-align:right;"><em>{{vatExemptText}}</em></td>
            </tr>
            {{/if}}
            <tr class="total-row">
                <td colspan="{{totalsColspan}}"><strong>{{#if showVat}}{{labels.grandTotal}}{{else}}{{labels.total}}{{/if}}</strong></td>
                <td><strong>{{currency}} {{totalTTC}}</strong></td>
            </tr>
        </tbody>
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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

/** Mirrors backend/src/utils/format-text.ts's formatRichText. */
function formatRichText(text?: string | null): string {
    if (!text) return ""
    const escaped = escapeHtml(text)
    const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    return withBold.replace(/\*(.+?)\*/g, "<em>$1</em>")
}

/** Mirrors backend/src/utils/pdf.ts's getInvertColor. */
function getInvertColor(hex: string): string {
    let cleanHex = hex.replace(/^#/, "")
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split("").map((c) => c + c).join("")
    }
    const r = parseInt(cleanHex.slice(0, 2), 16)
    const g = parseInt(cleanHex.slice(2, 4), 16)
    const b = parseInt(cleanHex.slice(4, 6), 16)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 186 ? "#000000" : "#ffffff"
}

/** Mirrors backend/src/utils/date.ts's formatDate. */
function formatQuoteDate(company: { dateFormat?: string }, date?: Date | string | null): string {
    if (!date) return "N/A"
    const allowedFormats = ["dd/MM/yyyy", "MM/dd/yyyy", "yyyy/MM/dd", "dd.MM.yyyy", "dd-MM-yyyy", "yyyy-MM-dd", "EEEE, dd MMM yyyy"]
    const dateFormat = allowedFormats.includes(company.dateFormat || "") ? (company.dateFormat as string) : "dd/MM/yyyy"
    return format(new Date(date), dateFormat)
}

function clampDiscountRate(rate?: number | null): number {
    if (typeof rate !== "number" || Number.isNaN(rate)) return 0
    return Math.min(Math.max(rate, 0), 100)
}

/** Mirrors backend/src/utils/financial.ts's calculateDiscountedTotals — presentation-only, real totals are always recomputed server-side on save. */
function calculateDiscountedTotals(
    items: { quantity: number; unitPrice: number; vatRate?: number | null }[],
    discountRate: number,
    isVatExempt: boolean,
) {
    const normalizedRate = clampDiscountRate(discountRate)
    const discountFactor = 1 - normalizedRate / 100

    const baseTotalHT = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0)
    const totalHT = baseTotalHT * discountFactor
    const discountAmountHT = baseTotalHT - totalHT

    const totalVAT = isVatExempt
        ? 0
        : items.reduce((sum, item) => {
              const vatRate = (item.vatRate || 0) / 100
              const discountedBase = (item.quantity || 0) * (item.unitPrice || 0) * discountFactor
              return sum + discountedBase * vatRate
          }, 0)

    const totalTTC = totalHT + totalVAT

    return { discountRate: normalizedRate, baseTotalHT, discountAmountHT, totalHT, totalVAT, totalTTC }
}

export function compileQuotePreview(data: Record<string, unknown>): string {
    return Handlebars.compile(quotePreviewTemplate)(data)
}

/** Assembles the same shaped data backend's getQuotePdf builds, sourced from live (possibly unsaved) form values and settings-panel state. */
export function buildQuotePreviewData(
    quote: Quote,
    values: QuoteFormValues,
    settings: TemplateSettings,
    paymentMethods: PaymentMethod[] | undefined,
) {
    const itemTypeLabels: Record<string, string> = {
        HOUR: settings.labels.hour,
        DAY: settings.labels.day,
        DEPOSIT: settings.labels.deposit,
        SERVICE: settings.labels.service,
        PRODUCT: settings.labels.product,
    }

    const paymentMethodLabels: Record<string, string> = {
        BANK_TRANSFER: settings.labels.paymentMethodBankTransfer,
        PAYPAL: settings.labels.paymentMethodPayPal,
        CASH: settings.labels.paymentMethodCash,
        CHECK: settings.labels.paymentMethodCheck,
        OTHER: settings.labels.paymentMethodOther,
    }

    let paymentMethodType: string | undefined = (quote as any).paymentMethod
    let paymentDetails: string | undefined = (quote as any).paymentDetails
    if (values.paymentMethodId) {
        const pm = paymentMethods?.find((p) => p.id === values.paymentMethodId)
        if (pm) {
            paymentMethodType = paymentMethodLabels[pm.type as string] || pm.type
            paymentDetails = pm.details || paymentDetails
        }
    }

    const isVatExempt = !!(quote.company.exemptVat && (quote.company.country || "").toUpperCase() === "FRANCE")
    const totals = calculateDiscountedTotals(values.items, values.discountRate, isVatExempt)
    const hasDiscount = totals.discountRate > 0 && totals.discountAmountHT > 0
    const showVat = isVatApplicable(totals.totalVAT, values.items)

    const clientName = quote.client.name || `${quote.client.contactFirstname || ""} ${quote.client.contactLastname || ""}`.trim()

    return {
        number: quote.rawNumber || quote.number.toString(),
        date: formatQuoteDate(quote.company as any, quote.createdAt),
        validUntil: formatQuoteDate(quote.company as any, values.validUntil ?? null),
        company: quote.company,
        client: { ...quote.client, name: clientName },
        currency: values.currency || quote.currency,
        items: values.items.map((i) => ({
            name: i.name,
            description: formatRichText(i.description),
            quantity: Number.isInteger(i.quantity) ? i.quantity.toString() : (i.quantity || 0).toFixed(3).replace(/\.?0+$/, ""),
            unitPrice: formatAmount(i.unitPrice || 0, quote.company.country),
            vatRate: i.vatRate,
            totalPrice: formatAmount((i.quantity || 0) * (i.unitPrice || 0) * (1 + (i.vatRate || 0) / 100), quote.company.country),
            type: itemTypeLabels[i.type] || i.type,
        })),
        totalHT: formatAmount(totals.totalHT, quote.company.country),
        totalVAT: formatAmount(totals.totalVAT, quote.company.country),
        totalTTC: formatAmount(totals.totalTTC, quote.company.country),
        subtotalBeforeDiscount: formatAmount(totals.baseTotalHT, quote.company.country),
        discountAmount: formatAmount(totals.discountAmountHT, quote.company.country),
        discountRate: Number(totals.discountRate.toFixed(2)),
        hasDiscount,
        showVat,
        totalsColspan: showVat ? 5 : 4,
        vatExemptText: isVatExempt ? "TVA non applicable, art. 293 B du CGI" : null,

        paymentMethod: paymentMethodType,
        paymentDetails,

        fontFamily: settings.fontFamily,
        padding: settings.padding,
        primaryColor: settings.primaryColor,
        secondaryColor: settings.secondaryColor,
        tableTextColor: getInvertColor(settings.secondaryColor),
        includeLogo: settings.includeLogo,
        logoB64: settings.logoB64 ?? "",
        isDraft: true,
        draftLabel: getDraftWatermarkLabel(quote.company.country),
        noteExists: !!values.notes,
        notes: formatRichText(values.notes).replace(/\n/g, "<br>"),
        labels: settings.labels,
    }
}

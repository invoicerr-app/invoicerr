import { Company, WebhookEvent } from "../../../../prisma/generated/prisma/client";

export interface EventStyle {
    color: string;
    emoji: string;
    title: string;
}

export const EVENT_STYLES: Record<WebhookEvent, EventStyle> = {
    // Quote events - Blue
    [WebhookEvent.QUOTE_CREATED]: { color: "#3b82f6", emoji: "📝", title: "Quote Created" },
    [WebhookEvent.QUOTE_UPDATED]: { color: "#3b82f6", emoji: "✏️", title: "Quote Updated" },
    [WebhookEvent.QUOTE_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Quote Deleted" },
    [WebhookEvent.QUOTE_SENT]: { color: "#10b981", emoji: "📤", title: "Quote Sent" },
    [WebhookEvent.QUOTE_SIGNED]: { color: "#10b981", emoji: "✅", title: "Quote Signed" },
    [WebhookEvent.QUOTE_EXPIRED]: { color: "#f59e0b", emoji: "⏰", title: "Quote Expired" },
    [WebhookEvent.QUOTE_REJECTED]: { color: "#ef4444", emoji: "❌", title: "Quote Rejected" },
    [WebhookEvent.QUOTE_VIEWED]: { color: "#8b5cf6", emoji: "👁️", title: "Quote Viewed" },
    [WebhookEvent.QUOTE_MARKED_AS_SIGNED]: { color: "#10b981", emoji: "✍️", title: "Quote Marked as Signed" },
    [WebhookEvent.QUOTE_PDF_GENERATED]: { color: "#6366f1", emoji: "📄", title: "Quote PDF Generated" },
    [WebhookEvent.QUOTE_SEARCHED]: { color: "#6b7280", emoji: "🔍", title: "Quote Searched" },
    [WebhookEvent.QUOTE_STATUS_CHANGED]: { color: "#3b82f6", emoji: "🔄", title: "Quote Status Changed" },

    // Invoice events - Green
    [WebhookEvent.INVOICE_CREATED]: { color: "#10b981", emoji: "📋", title: "Invoice Created" },
    [WebhookEvent.INVOICE_UPDATED]: { color: "#10b981", emoji: "✏️", title: "Invoice Updated" },
    [WebhookEvent.INVOICE_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Invoice Deleted" },
    [WebhookEvent.INVOICE_SENT]: { color: "#10b981", emoji: "📧", title: "Invoice Sent" },
    [WebhookEvent.INVOICE_PAID]: { color: "#10b981", emoji: "💰", title: "Invoice Paid" },
    [WebhookEvent.INVOICE_OVERDUE]: { color: "#ef4444", emoji: "⚠️", title: "Invoice Overdue" },
    [WebhookEvent.INVOICE_MARKED_AS_PAID]: { color: "#10b981", emoji: "✅", title: "Invoice Marked as Paid" },
    [WebhookEvent.INVOICE_PDF_GENERATED]: { color: "#6366f1", emoji: "📄", title: "Invoice PDF Generated" },
    [WebhookEvent.INVOICE_XML_DOWNLOADED]: { color: "#6366f1", emoji: "📥", title: "Invoice XML Downloaded" },
    [WebhookEvent.INVOICE_CREATED_FROM_QUOTE]: { color: "#10b981", emoji: "🔄", title: "Invoice Created from Quote" },
    [WebhookEvent.INVOICE_SEARCHED]: { color: "#6b7280", emoji: "🔍", title: "Invoice Searched" },
    [WebhookEvent.INVOICE_STATUS_CHANGED]: { color: "#10b981", emoji: "🔄", title: "Invoice Status Changed" },

    // Receipt events - Purple
    [WebhookEvent.RECEIPT_CREATED]: { color: "#8b5cf6", emoji: "🧾", title: "Receipt Created" },
    [WebhookEvent.RECEIPT_UPDATED]: { color: "#8b5cf6", emoji: "✏️", title: "Receipt Updated" },
    [WebhookEvent.RECEIPT_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Receipt Deleted" },
    [WebhookEvent.RECEIPT_SENT]: { color: "#8b5cf6", emoji: "📧", title: "Receipt Sent" },
    [WebhookEvent.RECEIPT_PDF_GENERATED]: { color: "#6366f1", emoji: "📄", title: "Receipt PDF Generated" },
    [WebhookEvent.RECEIPT_CREATED_FROM_INVOICE]: { color: "#8b5cf6", emoji: "🔄", title: "Receipt Created from Invoice" },
    [WebhookEvent.RECEIPT_SEARCHED]: { color: "#6b7280", emoji: "🔍", title: "Receipt Searched" },

    // Payment events - Yellow/Gold
    [WebhookEvent.PAYMENT_RECEIVED]: { color: "#f59e0b", emoji: "💵", title: "Payment Received" },
    [WebhookEvent.PAYMENT_METHOD_CREATED]: { color: "#f59e0b", emoji: "➕", title: "Payment Method Created" },
    [WebhookEvent.PAYMENT_METHOD_UPDATED]: { color: "#f59e0b", emoji: "✏️", title: "Payment Method Updated" },
    [WebhookEvent.PAYMENT_METHOD_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Payment Method Deleted" },
    [WebhookEvent.PAYMENT_METHOD_ACTIVATED]: { color: "#10b981", emoji: "✅", title: "Payment Method Activated" },
    [WebhookEvent.PAYMENT_METHOD_DEACTIVATED]: { color: "#6b7280", emoji: "⏸️", title: "Payment Method Deactivated" },

    // Signature events - Teal
    [WebhookEvent.SIGNATURE_CREATED]: { color: "#14b8a6", emoji: "📝", title: "Signature Created" },
    [WebhookEvent.SIGNATURE_COMPLETED]: { color: "#10b981", emoji: "✅", title: "Signature Completed" },
    [WebhookEvent.SIGNATURE_EXPIRED]: { color: "#f59e0b", emoji: "⏰", title: "Signature Expired" },
    [WebhookEvent.SIGNATURE_OTP_GENERATED]: { color: "#14b8a6", emoji: "🔐", title: "Signature OTP Generated" },
    [WebhookEvent.SIGNATURE_OTP_SENT]: { color: "#14b8a6", emoji: "📧", title: "Signature OTP Sent" },
    [WebhookEvent.SIGNATURE_VIEWED]: { color: "#8b5cf6", emoji: "👁️", title: "Signature Viewed" },
    [WebhookEvent.SIGNATURE_EMAIL_SENT]: { color: "#14b8a6", emoji: "📧", title: "Signature Email Sent" },

    // Client events - Pink
    [WebhookEvent.CLIENT_CREATED]: { color: "#ec4899", emoji: "👤", title: "Client Created" },
    [WebhookEvent.CLIENT_UPDATED]: { color: "#ec4899", emoji: "✏️", title: "Client Updated" },
    [WebhookEvent.CLIENT_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Client Deleted" },
    [WebhookEvent.CLIENT_ACTIVATED]: { color: "#10b981", emoji: "✅", title: "Client Activated" },
    [WebhookEvent.CLIENT_DEACTIVATED]: { color: "#6b7280", emoji: "⏸️", title: "Client Deactivated" },
    [WebhookEvent.CLIENT_SEARCHED]: { color: "#6b7280", emoji: "🔍", title: "Client Searched" },

    // Company events - Orange
    [WebhookEvent.COMPANY_CREATED]: { color: "#f97316", emoji: "🏢", title: "Company Created" },
    [WebhookEvent.COMPANY_UPDATED]: { color: "#f97316", emoji: "✏️", title: "Company Updated" },
    [WebhookEvent.COMPANY_PDF_CONFIG_UPDATED]: { color: "#f97316", emoji: "⚙️", title: "PDF Config Updated" },
    [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: { color: "#f97316", emoji: "📧", title: "Email Template Updated" },
    [WebhookEvent.COMPANY_INFO_VIEWED]: { color: "#6b7280", emoji: "👁️", title: "Company Info Viewed" },

    // Recurring Invoice events - Cyan
    [WebhookEvent.RECURRING_INVOICE_CREATED]: { color: "#06b6d4", emoji: "🔁", title: "Recurring Invoice Created" },
    [WebhookEvent.RECURRING_INVOICE_UPDATED]: { color: "#06b6d4", emoji: "✏️", title: "Recurring Invoice Updated" },
    [WebhookEvent.RECURRING_INVOICE_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Recurring Invoice Deleted" },
    [WebhookEvent.RECURRING_INVOICE_GENERATED]: { color: "#10b981", emoji: "🔄", title: "Recurring Invoice Generated" },
    [WebhookEvent.RECURRING_INVOICE_AUTO_SENT]: { color: "#10b981", emoji: "📧", title: "Recurring Invoice Auto-Sent" },
    [WebhookEvent.RECURRING_INVOICE_PROCESSED]: { color: "#06b6d4", emoji: "⚙️", title: "Recurring Invoice Processed" },
    [WebhookEvent.RECURRING_INVOICE_NEXT_DATE_CALCULATED]: { color: "#06b6d4", emoji: "📅", title: "Next Date Calculated" },

    // Plugin events - Indigo
    [WebhookEvent.PLUGIN_ACTIVATED]: { color: "#6366f1", emoji: "🔌", title: "Plugin Activated" },
    [WebhookEvent.PLUGIN_DEACTIVATED]: { color: "#6b7280", emoji: "⏸️", title: "Plugin Deactivated" },
    [WebhookEvent.PLUGIN_CONFIGURED]: { color: "#6366f1", emoji: "⚙️", title: "Plugin Configured" },
    [WebhookEvent.PLUGIN_ADDED]: { color: "#10b981", emoji: "➕", title: "Plugin Added" },
    [WebhookEvent.PLUGIN_REMOVED]: { color: "#ef4444", emoji: "➖", title: "Plugin Removed" },
    [WebhookEvent.PLUGIN_VALIDATED]: { color: "#10b981", emoji: "✅", title: "Plugin Validated" },
    [WebhookEvent.PLUGIN_PROVIDER_REQUESTED]: { color: "#6366f1", emoji: "🔌", title: "Plugin Provider Requested" },
    [WebhookEvent.PLUGIN_FORMAT_REQUESTED]: { color: "#6366f1", emoji: "📄", title: "Plugin Format Requested" },
    [WebhookEvent.PLUGIN_WEBHOOK_RECEIVED]: { color: "#6366f1", emoji: "📥", title: "Plugin Webhook Received" },

    // Authentication events - Red
    [WebhookEvent.USER_CREATED]: { color: "#ef4444", emoji: "👤", title: "User Created" },
    [WebhookEvent.USER_UPDATED]: { color: "#ef4444", emoji: "✏️", title: "User Updated" },
    [WebhookEvent.USER_LOGGED_IN]: { color: "#10b981", emoji: "🔓", title: "User Logged In" },
    [WebhookEvent.USER_PASSWORD_CHANGED]: { color: "#f59e0b", emoji: "🔑", title: "Password Changed" },
    [WebhookEvent.USER_PROFILE_UPDATED]: { color: "#ef4444", emoji: "✏️", title: "User Profile Updated" },
    [WebhookEvent.USER_OIDC_LOGIN]: { color: "#10b981", emoji: "🔐", title: "OIDC Login" },
    [WebhookEvent.USER_OIDC_CALLBACK]: { color: "#6366f1", emoji: "🔄", title: "OIDC Callback" },

    // Email events - Sky Blue
    [WebhookEvent.EMAIL_SENT]: { color: "#0ea5e9", emoji: "📧", title: "Email Sent" },
    [WebhookEvent.EMAIL_TEMPLATE_UPDATED]: { color: "#0ea5e9", emoji: "✏️", title: "Email Template Updated" },
    [WebhookEvent.EMAIL_FAILED]: { color: "#ef4444", emoji: "❌", title: "Email Failed" },

    // Dashboard events - Gray
    [WebhookEvent.DASHBOARD_VIEWED]: { color: "#6b7280", emoji: "📊", title: "Dashboard Viewed" },
    [WebhookEvent.DASHBOARD_STATS_CALCULATED]: { color: "#6b7280", emoji: "📈", title: "Dashboard Stats Calculated" },
    [WebhookEvent.STATS_MONTHLY_REQUESTED]: { color: "#6b7280", emoji: "📊", title: "Monthly Stats Requested" },
    [WebhookEvent.STATS_YEARLY_REQUESTED]: { color: "#6b7280", emoji: "📊", title: "Yearly Stats Requested" },
    [WebhookEvent.CURRENCY_RATE_UPDATED]: { color: "#f59e0b", emoji: "💱", title: "Currency Rate Updated" },

    // System events - Dark Gray
    [WebhookEvent.APP_RESET]: { color: "#ef4444", emoji: "🔄", title: "App Reset" },
    [WebhookEvent.APP_ALL_DATA_RESET]: { color: "#ef4444", emoji: "⚠️", title: "All Data Reset" },
    [WebhookEvent.OTP_REQUESTED]: { color: "#6b7280", emoji: "🔐", title: "OTP Requested" },
    [WebhookEvent.OTP_VALIDATED]: { color: "#10b981", emoji: "✅", title: "OTP Validated" },
    [WebhookEvent.OTP_EXPIRED]: { color: "#f59e0b", emoji: "⏰", title: "OTP Expired" },

    // Search events
    [WebhookEvent.SEARCH_PERFORMED]: { color: "#6b7280", emoji: "🔍", title: "Search Performed" },

    // File events
    [WebhookEvent.PDF_GENERATED]: { color: "#6366f1", emoji: "📄", title: "PDF Generated" },
    [WebhookEvent.XML_GENERATED]: { color: "#6366f1", emoji: "📄", title: "XML Generated" },
    [WebhookEvent.FILE_DOWNLOADED]: { color: "#6366f1", emoji: "📥", title: "File Downloaded" },

    // Webhook events
    [WebhookEvent.WEBHOOK_CREATED]: { color: "#8b5cf6", emoji: "🪝", title: "Webhook Created" },
    [WebhookEvent.WEBHOOK_UPDATED]: { color: "#8b5cf6", emoji: "✏️", title: "Webhook Updated" },
    [WebhookEvent.WEBHOOK_DELETED]: { color: "#ef4444", emoji: "🗑️", title: "Webhook Deleted" },
    [WebhookEvent.WEBHOOK_TRIGGERED]: { color: "#10b981", emoji: "🔔", title: "Webhook Triggered" },
    [WebhookEvent.WEBHOOK_FAILED]: { color: "#ef4444", emoji: "❌", title: "Webhook Failed" },

    // Item events
    [WebhookEvent.QUOTE_ITEM_CREATED]: { color: "#3b82f6", emoji: "➕", title: "Quote Item Created" },
    [WebhookEvent.QUOTE_ITEM_UPDATED]: { color: "#3b82f6", emoji: "✏️", title: "Quote Item Updated" },
    [WebhookEvent.QUOTE_ITEM_DELETED]: { color: "#ef4444", emoji: "➖", title: "Quote Item Deleted" },
    [WebhookEvent.INVOICE_ITEM_CREATED]: { color: "#10b981", emoji: "➕", title: "Invoice Item Created" },
    [WebhookEvent.INVOICE_ITEM_UPDATED]: { color: "#10b981", emoji: "✏️", title: "Invoice Item Updated" },
    [WebhookEvent.INVOICE_ITEM_DELETED]: { color: "#ef4444", emoji: "➖", title: "Invoice Item Deleted" },
    [WebhookEvent.RECEIPT_ITEM_CREATED]: { color: "#8b5cf6", emoji: "➕", title: "Receipt Item Created" },
    [WebhookEvent.RECEIPT_ITEM_UPDATED]: { color: "#8b5cf6", emoji: "✏️", title: "Receipt Item Updated" },
    [WebhookEvent.RECEIPT_ITEM_DELETED]: { color: "#ef4444", emoji: "➖", title: "Receipt Item Deleted" },
    [WebhookEvent.RECURRING_INVOICE_ITEM_CREATED]: { color: "#06b6d4", emoji: "➕", title: "Recurring Invoice Item Created" },
    [WebhookEvent.RECURRING_INVOICE_ITEM_UPDATED]: { color: "#06b6d4", emoji: "✏️", title: "Recurring Invoice Item Updated" },
    [WebhookEvent.RECURRING_INVOICE_ITEM_DELETED]: { color: "#ef4444", emoji: "➖", title: "Recurring Invoice Item Deleted" },

    // Config events
    [WebhookEvent.PDF_CONFIG_CREATED]: { color: "#6366f1", emoji: "⚙️", title: "PDF Config Created" },
    [WebhookEvent.PDF_CONFIG_UPDATED]: { color: "#6366f1", emoji: "⚙️", title: "PDF Config Updated" },
    [WebhookEvent.EMAIL_TEMPLATE_CREATED]: { color: "#0ea5e9", emoji: "📧", title: "Email Template Created" },

    // Number formatting events
    [WebhookEvent.QUOTE_NUMBER_GENERATED]: { color: "#3b82f6", emoji: "🔢", title: "Quote Number Generated" },
    [WebhookEvent.INVOICE_NUMBER_GENERATED]: { color: "#10b981", emoji: "🔢", title: "Invoice Number Generated" },
    [WebhookEvent.RECEIPT_NUMBER_GENERATED]: { color: "#8b5cf6", emoji: "🔢", title: "Receipt Number Generated" },

    // Background process events
    [WebhookEvent.CRON_JOB_STARTED]: { color: "#6b7280", emoji: "⏰", title: "Cron Job Started" },
    [WebhookEvent.CRON_JOB_COMPLETED]: { color: "#10b981", emoji: "✅", title: "Cron Job Completed" },
    [WebhookEvent.CRON_JOB_FAILED]: { color: "#ef4444", emoji: "❌", title: "Cron Job Failed" },

    // Currency events
    [WebhookEvent.CURRENCY_CONVERSION_REQUESTED]: { color: "#f59e0b", emoji: "💱", title: "Currency Conversion Requested" },
    [WebhookEvent.CURRENCY_RATE_FETCHED]: { color: "#f59e0b", emoji: "💱", title: "Currency Rate Fetched" },

    // Mail template events
    [WebhookEvent.MAIL_TEMPLATE_CREATED]: { color: "#0ea5e9", emoji: "📧", title: "Mail Template Created" },
    [WebhookEvent.MAIL_TEMPLATE_UPDATED]: { color: "#0ea5e9", emoji: "✏️", title: "Mail Template Updated" },

    // SSE events
    [WebhookEvent.SSE_CONNECTION_ESTABLISHED]: { color: "#6b7280", emoji: "🔌", title: "SSE Connection Established" },
    [WebhookEvent.SSE_DATA_STREAMED]: { color: "#6b7280", emoji: "📡", title: "SSE Data Streamed" },

    // Validation events
    [WebhookEvent.DATA_VALIDATED]: { color: "#10b981", emoji: "✅", title: "Data Validated" },
    [WebhookEvent.CONFIGURATION_VALIDATED]: { color: "#10b981", emoji: "✅", title: "Configuration Validated" },
};

export function formatPayloadForEvent(event: WebhookEvent, payload: any): string {
    // Format specific data based on event type
    const formatters: Record<WebhookEvent, (p: any) => string | null> = {
        // Quote events
        [WebhookEvent.QUOTE_CREATED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nTotal Inc. Tax: ${p.quote?.totalTTC || 0}${p.quote?.currency || '€'}`,
        [WebhookEvent.QUOTE_UPDATED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.QUOTE_DELETED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.QUOTE_SENT]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.QUOTE_SIGNED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.QUOTE_EXPIRED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nExpired on: ${p.quote?.expiresAt ? new Date(p.quote.expiresAt).toLocaleDateString('en-US') : 'N/A'}`,
        [WebhookEvent.QUOTE_REJECTED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.QUOTE_VIEWED]: (p) => null,
        [WebhookEvent.QUOTE_MARKED_AS_SIGNED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nMarked as signed`,
        [WebhookEvent.QUOTE_PDF_GENERATED]: (p) => null,
        [WebhookEvent.QUOTE_SEARCHED]: (p) => null,
        [WebhookEvent.QUOTE_STATUS_CHANGED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nNew status: ${p.newStatus || 'N/A'}`,

        // Invoice events
        [WebhookEvent.INVOICE_CREATED]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nTotal Inc. Tax: ${p.invoice?.totalTTC || 0}${p.invoice?.currency || '€'}`,
        [WebhookEvent.INVOICE_UPDATED]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.INVOICE_DELETED]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.INVOICE_SENT]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.INVOICE_PAID]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nAmount: ${p.invoice?.totalTTC || 0}${p.invoice?.currency || '€'}\n💰 Paid on ${p.invoice?.paidAt ? new Date(p.invoice.paidAt).toLocaleDateString('en-US') : 'N/A'}`,
        [WebhookEvent.INVOICE_OVERDUE]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\n⚠️ Due date passed: ${p.invoice?.dueDate ? new Date(p.invoice.dueDate).toLocaleDateString('en-US') : 'N/A'}`,
        [WebhookEvent.INVOICE_MARKED_AS_PAID]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nMarked as paid`,
        [WebhookEvent.INVOICE_PDF_GENERATED]: (p) => null,
        [WebhookEvent.INVOICE_XML_DOWNLOADED]: (p) => null,
        [WebhookEvent.INVOICE_CREATED_FROM_QUOTE]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nFrom Quote #${p.quote?.number || 'N/A'}`,
        [WebhookEvent.INVOICE_SEARCHED]: (p) => null,
        [WebhookEvent.INVOICE_STATUS_CHANGED]: (p) =>
            `**Invoice #${p.invoice?.number || p.invoiceId}**\nNew status: ${p.newStatus || 'N/A'}`,

        // Receipt events
        [WebhookEvent.RECEIPT_CREATED]: (p) =>
            `**Receipt #${p.receipt?.number || p.receiptId}**\nInvoice: #${p.invoice?.number || 'N/A'}\nAmount: ${p.receipt?.totalPaid || 0}${p.invoice?.currency || '€'}`,
        [WebhookEvent.RECEIPT_UPDATED]: (p) =>
            `**Receipt #${p.receipt?.number || p.receiptId}**\nInvoice: #${p.invoice?.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_DELETED]: (p) =>
            `**Receipt #${p.receipt?.number || p.receiptId}**\nInvoice: #${p.invoice?.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_SENT]: (p) =>
            `**Receipt #${p.receipt?.number || p.receiptId}**\nInvoice: #${p.invoice?.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_PDF_GENERATED]: (p) => null,
        [WebhookEvent.RECEIPT_CREATED_FROM_INVOICE]: (p) =>
            `**Receipt #${p.receipt?.number || p.receiptId}**\nFrom Invoice #${p.invoice?.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_SEARCHED]: (p) => null,

        // Payment events
        [WebhookEvent.PAYMENT_RECEIVED]: (p) =>
            `Amount: ${p.amount || 0}${p.currency || '€'}\nMethod: ${p.paymentMethod || 'N/A'}`,
        [WebhookEvent.PAYMENT_METHOD_CREATED]: (p) =>
            `**${p.paymentMethod?.name || 'N/A'}**\nType: ${p.paymentMethod?.type || 'N/A'}`,
        [WebhookEvent.PAYMENT_METHOD_UPDATED]: (p) =>
            `**${p.paymentMethod?.name || 'N/A'}**\nType: ${p.paymentMethod?.type || 'N/A'}`,
        [WebhookEvent.PAYMENT_METHOD_DELETED]: (p) =>
            `**${p.paymentMethod?.name || 'N/A'}**`,
        [WebhookEvent.PAYMENT_METHOD_ACTIVATED]: (p) =>
            `**${p.paymentMethod?.name || 'N/A'}**`,
        [WebhookEvent.PAYMENT_METHOD_DEACTIVATED]: (p) =>
            `**${p.paymentMethod?.name || 'N/A'}**`,

        // Signature events
        [WebhookEvent.SIGNATURE_CREATED]: (p) =>
            `**Quote #${p.quote?.number || p.quoteId}**\nSignature request sent`,
        [WebhookEvent.SIGNATURE_COMPLETED]: (p) =>
            `**Quote #${p.quoteId || 'N/A'}**\n✅ Signature completed`,
        [WebhookEvent.SIGNATURE_EXPIRED]: (p) =>
            `**Quote #${p.quoteId || 'N/A'}**\nSignature expired`,
        [WebhookEvent.SIGNATURE_OTP_GENERATED]: (p) =>
            `OTP code generated for signature\nQuote: #${p.quoteId || 'N/A'}`,
        [WebhookEvent.SIGNATURE_OTP_SENT]: (p) =>
            `OTP sent for signature\nQuote: #${p.quoteId || 'N/A'}`,
        [WebhookEvent.SIGNATURE_VIEWED]: (p) => null,
        [WebhookEvent.SIGNATURE_EMAIL_SENT]: (p) =>
            `Signature email sent\nQuote: #${p.quoteId || 'N/A'}`,

        // Client events
        [WebhookEvent.CLIENT_CREATED]: (p) =>
            `**${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}\nCity: ${p.client?.city || 'N/A'}`,
        [WebhookEvent.CLIENT_UPDATED]: (p) =>
            `**${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}`,
        [WebhookEvent.CLIENT_DELETED]: (p) =>
            `**${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
        [WebhookEvent.CLIENT_ACTIVATED]: (p) =>
            `**${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
        [WebhookEvent.CLIENT_DEACTIVATED]: (p) =>
            `**${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
        [WebhookEvent.CLIENT_SEARCHED]: (p) => null,

        // Company events
        [WebhookEvent.COMPANY_CREATED]: (p: { company: Company }) =>
            `**${p.company?.name || 'N/A'}**`,
        [WebhookEvent.COMPANY_UPDATED]: (p: { company: Company }) =>
            `**${p.company?.name || 'N/A'}**\nUpdate completed`,
        [WebhookEvent.COMPANY_PDF_CONFIG_UPDATED]: (p: { company: Company }) =>
            `**${p.company?.name || 'N/A'}**\nPDF configuration updated`,
        [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: (p: { company: Company }) =>
            `**${p.company?.name || 'N/A'}**\nEmail template updated`,
        [WebhookEvent.COMPANY_INFO_VIEWED]: (p) => null,

        // Recurring Invoice events
        [WebhookEvent.RECURRING_INVOICE_CREATED]: (p) =>
            `Client: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nFrequency: ${p.recurringInvoice?.frequency || 'N/A'}\nAmount: ${p.recurringInvoice?.totalTTC || 0}${p.recurringInvoice?.currency || '€'}`,
        [WebhookEvent.RECURRING_INVOICE_UPDATED]: (p) =>
            `Client: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nFrequency: ${p.recurringInvoice?.frequency || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_DELETED]: (p) =>
            `Client: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_GENERATED]: (p) =>
            `Recurring invoice generated\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_AUTO_SENT]: (p) =>
            `Recurring invoice auto-sent\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_PROCESSED]: (p) =>
            `Recurring invoice processed\nClient: ${(p.client.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_NEXT_DATE_CALCULATED]: (p) =>
            `Next date: ${p.nextDate ? new Date(p.nextDate).toLocaleDateString('en-US') : 'N/A'}`,

        // Plugin events
        [WebhookEvent.PLUGIN_ACTIVATED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
        [WebhookEvent.PLUGIN_DEACTIVATED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
        [WebhookEvent.PLUGIN_CONFIGURED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**\nConfiguration updated`,
        [WebhookEvent.PLUGIN_ADDED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
        [WebhookEvent.PLUGIN_REMOVED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**`,
        [WebhookEvent.PLUGIN_VALIDATED]: (p) =>
            `**${p.plugin?.name || 'N/A'}**`,
        [WebhookEvent.PLUGIN_PROVIDER_REQUESTED]: (p) => null,
        [WebhookEvent.PLUGIN_FORMAT_REQUESTED]: (p) => null,
        [WebhookEvent.PLUGIN_WEBHOOK_RECEIVED]: (p) =>
            `Plugin: ${p.plugin?.name || 'N/A'}`,

        // Authentication events
        [WebhookEvent.USER_CREATED]: (p) =>
            `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_UPDATED]: (p) =>
            `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_LOGGED_IN]: (p) =>
            `👤 ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_PASSWORD_CHANGED]: (p) =>
            `User: ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_PROFILE_UPDATED]: (p) =>
            `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_OIDC_LOGIN]: (p) =>
            `👤 ${p.user?.email || 'N/A'}`,
        [WebhookEvent.USER_OIDC_CALLBACK]: (p) => null,

        // Email events
        [WebhookEvent.EMAIL_SENT]: (p) =>
            `To: ${p.to || 'N/A'}\nSubject: ${p.subject || 'N/A'}`,
        [WebhookEvent.EMAIL_TEMPLATE_UPDATED]: (p) =>
            `Template: ${p.template?.name || 'N/A'}`,
        [WebhookEvent.EMAIL_FAILED]: (p) =>
            `To: ${p.to || 'N/A'}\nError: ${p.error || 'N/A'}`,

        // Dashboard events
        [WebhookEvent.DASHBOARD_VIEWED]: (p) => null,
        [WebhookEvent.DASHBOARD_STATS_CALCULATED]: (p) => null,
        [WebhookEvent.STATS_MONTHLY_REQUESTED]: (p) => null,
        [WebhookEvent.STATS_YEARLY_REQUESTED]: (p) => null,
        [WebhookEvent.CURRENCY_RATE_UPDATED]: (p) =>
            `Currency: ${p.currency || 'N/A'}\nRate: ${p.rate || 'N/A'}`,

        // System events
        [WebhookEvent.APP_RESET]: (p) => null,
        [WebhookEvent.APP_ALL_DATA_RESET]: (p) => null,
        [WebhookEvent.OTP_REQUESTED]: (p) => null,
        [WebhookEvent.OTP_VALIDATED]: (p) => null,
        [WebhookEvent.OTP_EXPIRED]: (p) => null,

        // Search events
        [WebhookEvent.SEARCH_PERFORMED]: (p) => null,

        // File events
        [WebhookEvent.PDF_GENERATED]: (p) => null,
        [WebhookEvent.XML_GENERATED]: (p) => null,
        [WebhookEvent.FILE_DOWNLOADED]: (p) => null,

        // Webhook events
        [WebhookEvent.WEBHOOK_CREATED]: (p) =>
            `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
        [WebhookEvent.WEBHOOK_UPDATED]: (p) =>
            `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
        [WebhookEvent.WEBHOOK_DELETED]: (p) =>
            `Type: ${p.webhook?.type || 'N/A'}`,
        [WebhookEvent.WEBHOOK_TRIGGERED]: (p) =>
            `Type: ${p.webhook?.type || 'N/A'}`,
        [WebhookEvent.WEBHOOK_FAILED]: (p) =>
            `❌ URL: ${p.webhook?.url || 'N/A'}\nError: ${p.error || 'N/A'}`,

        // Item events
        [WebhookEvent.QUOTE_ITEM_CREATED]: (p) =>
            `Quote: #${p.quote?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.QUOTE_ITEM_UPDATED]: (p) =>
            `Quote: #${p.quote?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.QUOTE_ITEM_DELETED]: (p) =>
            `Quote: #${p.quote?.number || 'N/A'}`,
        [WebhookEvent.INVOICE_ITEM_CREATED]: (p) =>
            `Invoice: #${p.invoice?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.INVOICE_ITEM_UPDATED]: (p) =>
            `Invoice: #${p.invoice?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.INVOICE_ITEM_DELETED]: (p) =>
            `Invoice: #${p.invoice?.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_ITEM_CREATED]: (p) =>
            `Receipt: #${p.receipt?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.RECEIPT_ITEM_UPDATED]: (p) =>
            `Receipt: #${p.receipt?.number || 'N/A'}\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.RECEIPT_ITEM_DELETED]: (p) =>
            `Receipt: #${p.receipt?.number || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_ITEM_CREATED]: (p) =>
            `Recurring Invoice\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_ITEM_UPDATED]: (p) =>
            `Recurring Invoice\nItem: ${p.item?.description || 'N/A'}`,
        [WebhookEvent.RECURRING_INVOICE_ITEM_DELETED]: (p) =>
            `Recurring Invoice`,

        // Config events
        [WebhookEvent.PDF_CONFIG_CREATED]: (p) =>
            `Company: ${p.company?.name || 'N/A'}`,
        [WebhookEvent.PDF_CONFIG_UPDATED]: (p) =>
            `Company: ${p.company?.name || 'N/A'}`,
        [WebhookEvent.EMAIL_TEMPLATE_CREATED]: (p) =>
            `Template: ${p.template?.name || 'N/A'}`,

        // Number formatting events
        [WebhookEvent.QUOTE_NUMBER_GENERATED]: (p) =>
            `Quote number: ${p.number || 'N/A'}`,
        [WebhookEvent.INVOICE_NUMBER_GENERATED]: (p) =>
            `Invoice number: ${p.number || 'N/A'}`,
        [WebhookEvent.RECEIPT_NUMBER_GENERATED]: (p) =>
            `Receipt number: ${p.number || 'N/A'}`,

        // Background process events
        [WebhookEvent.CRON_JOB_STARTED]: (p) =>
            `Job: ${p.jobName || 'N/A'}`,
        [WebhookEvent.CRON_JOB_COMPLETED]: (p) =>
            `Job: ${p.jobName || 'N/A'}`,
        [WebhookEvent.CRON_JOB_FAILED]: (p) =>
            `Job: ${p.jobName || 'N/A'}\nError: ${p.error || 'N/A'}`,

        // Currency events
        [WebhookEvent.CURRENCY_CONVERSION_REQUESTED]: (p) =>
            `From: ${p.from || 'N/A'}\nTo: ${p.to || 'N/A'}\nAmount: ${p.amount || 0}`,
        [WebhookEvent.CURRENCY_RATE_FETCHED]: (p) =>
            `Currency: ${p.currency || 'N/A'}\nRate: ${p.rate || 'N/A'}`,

        // Mail template events
        [WebhookEvent.MAIL_TEMPLATE_CREATED]: (p) =>
            `Template: ${p.template?.name || 'N/A'}`,
        [WebhookEvent.MAIL_TEMPLATE_UPDATED]: (p) =>
            `Template: ${p.template?.name || 'N/A'}`,

        // SSE events
        [WebhookEvent.SSE_CONNECTION_ESTABLISHED]: (p) => null,
        [WebhookEvent.SSE_DATA_STREAMED]: (p) => null,

        // Validation events
        [WebhookEvent.DATA_VALIDATED]: (p) => null,
        [WebhookEvent.CONFIGURATION_VALIDATED]: (p) => null,
    };

    const formatter = formatters[event];
    if (formatter) {
        try {
            const result = formatter(payload);
            if (result !== null) {
                return result;
            }
        } catch (error) {
            return `Data: ${JSON.stringify(payload, null, 2).substring(0, 500)}`;
        }
    }

    // Default formatting for events without specific formatter
    return `Event triggered successfully`;
}

import { Company, WebhookEvent } from '../../../../prisma/generated/prisma/client';

/**
 * TODO_PRODUIT.md T2bis — the per-type `QUOTE_*`/`INVOICE_*`/`PAYMENT_*`(document)/`RECEIPT_*`/
 * `SIGNATURE_*`/`PAYMENT_METHOD_*`/`PAYMENT_RECEIVED` formatters this file used to carry are GONE —
 * every one of those enum members was purged (see the migration's own header for the grep proof, one
 * value at a time) because none had a real emitter, INVOICE_SENT/QUOTE_SENT included (T2's own two
 * exceptions, whose sole emitter this same task replaces with the generic `DOCUMENT_*` formatters
 * right below). `documentLabel`/`documentNumber` read the UNIFORM payload contract
 * (`queue/document-webhooks.ts#buildDocumentWebhookPayload`) so ONE formatter per `DOCUMENT_*` event
 * covers every document type, whatever `typeId` a future one adds.
 */
function documentLabel(typeId: unknown): string {
  if (typeof typeId !== 'string' || !typeId) return 'Document';
  return typeId
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function documentNumber(payload: any): string {
  const document = payload?.document;
  return document?.displayNumber || document?.number || payload?.documentId || 'N/A';
}

export interface EventStyle {
  color: string;
  emoji: string;
  title: string;
}

export const EVENT_STYLES: Record<WebhookEvent, EventStyle> = {
  // Document events - Green (generic, TODO_PRODUIT.md T2bis)
  [WebhookEvent.DOCUMENT_CREATED]: { color: '#10b981', emoji: '🆕', title: 'Document Created' },
  [WebhookEvent.DOCUMENT_SENT]: { color: '#10b981', emoji: '📤', title: 'Document Sent' },
  [WebhookEvent.DOCUMENT_SEND_FAILED]: { color: '#ef4444', emoji: '⚠️', title: 'Document Send Failed' },
  [WebhookEvent.DOCUMENT_AUTHORITY_EVENT]: { color: '#6366f1', emoji: '🏛️', title: 'Authority Event' },
  [WebhookEvent.DOCUMENT_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Document Deleted' },
  // TODO_PRODUIT.md T3 — see settlement/document-settled.ts's own header for when this fires.
  [WebhookEvent.DOCUMENT_SETTLED]: { color: '#10b981', emoji: '✅', title: 'Document Settled' },
  // TODO_CORRECTION.md C3 — see actions/invoice-actions.ts's own "cancel" handler for when this fires.
  [WebhookEvent.DOCUMENT_CANCELLED]: { color: '#ef4444', emoji: '🚫', title: 'Document Cancelled' },

  // Client events - Pink
  [WebhookEvent.CLIENT_CREATED]: { color: '#ec4899', emoji: '👤', title: 'Client Created' },
  [WebhookEvent.CLIENT_UPDATED]: { color: '#ec4899', emoji: '✏️', title: 'Client Updated' },
  [WebhookEvent.CLIENT_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Client Deleted' },
  [WebhookEvent.CLIENT_ACTIVATED]: { color: '#10b981', emoji: '✅', title: 'Client Activated' },
  [WebhookEvent.CLIENT_DEACTIVATED]: { color: '#6b7280', emoji: '⏸️', title: 'Client Deactivated' },
  [WebhookEvent.CLIENT_SEARCHED]: { color: '#6b7280', emoji: '🔍', title: 'Client Searched' },

  // Company events - Orange
  [WebhookEvent.COMPANY_CREATED]: { color: '#f97316', emoji: '🏢', title: 'Company Created' },
  [WebhookEvent.COMPANY_UPDATED]: { color: '#f97316', emoji: '✏️', title: 'Company Updated' },
  [WebhookEvent.COMPANY_PDF_CONFIG_UPDATED]: { color: '#f97316', emoji: '⚙️', title: 'PDF Config Updated' },
  [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: {
    color: '#f97316',
    emoji: '📧',
    title: 'Email Template Updated',
  },
  [WebhookEvent.COMPANY_INFO_VIEWED]: { color: '#6b7280', emoji: '👁️', title: 'Company Info Viewed' },

  // Recurring Invoice events - Cyan
  [WebhookEvent.RECURRING_INVOICE_CREATED]: {
    color: '#06b6d4',
    emoji: '🔁',
    title: 'Recurring Invoice Created',
  },
  [WebhookEvent.RECURRING_INVOICE_UPDATED]: {
    color: '#06b6d4',
    emoji: '✏️',
    title: 'Recurring Invoice Updated',
  },
  [WebhookEvent.RECURRING_INVOICE_DELETED]: {
    color: '#ef4444',
    emoji: '🗑️',
    title: 'Recurring Invoice Deleted',
  },
  [WebhookEvent.RECURRING_INVOICE_GENERATED]: {
    color: '#10b981',
    emoji: '🔄',
    title: 'Recurring Invoice Generated',
  },
  [WebhookEvent.RECURRING_INVOICE_AUTO_SENT]: {
    color: '#10b981',
    emoji: '📧',
    title: 'Recurring Invoice Auto-Sent',
  },
  [WebhookEvent.RECURRING_INVOICE_PROCESSED]: {
    color: '#06b6d4',
    emoji: '⚙️',
    title: 'Recurring Invoice Processed',
  },
  [WebhookEvent.RECURRING_INVOICE_NEXT_DATE_CALCULATED]: {
    color: '#06b6d4',
    emoji: '📅',
    title: 'Next Date Calculated',
  },

  // Plugin events - Indigo
  [WebhookEvent.PLUGIN_ACTIVATED]: { color: '#6366f1', emoji: '🔌', title: 'Plugin Activated' },
  [WebhookEvent.PLUGIN_DEACTIVATED]: { color: '#6b7280', emoji: '⏸️', title: 'Plugin Deactivated' },
  [WebhookEvent.PLUGIN_CONFIGURED]: { color: '#6366f1', emoji: '⚙️', title: 'Plugin Configured' },
  [WebhookEvent.PLUGIN_ADDED]: { color: '#10b981', emoji: '➕', title: 'Plugin Added' },
  [WebhookEvent.PLUGIN_REMOVED]: { color: '#ef4444', emoji: '➖', title: 'Plugin Removed' },
  [WebhookEvent.PLUGIN_VALIDATED]: { color: '#10b981', emoji: '✅', title: 'Plugin Validated' },
  [WebhookEvent.PLUGIN_PROVIDER_REQUESTED]: {
    color: '#6366f1',
    emoji: '🔌',
    title: 'Plugin Provider Requested',
  },
  [WebhookEvent.PLUGIN_FORMAT_REQUESTED]: { color: '#6366f1', emoji: '📄', title: 'Plugin Format Requested' },
  [WebhookEvent.PLUGIN_WEBHOOK_RECEIVED]: { color: '#6366f1', emoji: '📥', title: 'Plugin Webhook Received' },

  // Authentication events - Red
  [WebhookEvent.USER_CREATED]: { color: '#ef4444', emoji: '👤', title: 'User Created' },
  [WebhookEvent.USER_UPDATED]: { color: '#ef4444', emoji: '✏️', title: 'User Updated' },
  [WebhookEvent.USER_LOGGED_IN]: { color: '#10b981', emoji: '🔓', title: 'User Logged In' },
  [WebhookEvent.USER_PASSWORD_CHANGED]: { color: '#f59e0b', emoji: '🔑', title: 'Password Changed' },
  [WebhookEvent.USER_PROFILE_UPDATED]: { color: '#ef4444', emoji: '✏️', title: 'User Profile Updated' },
  [WebhookEvent.USER_OIDC_LOGIN]: { color: '#10b981', emoji: '🔐', title: 'OIDC Login' },
  [WebhookEvent.USER_OIDC_CALLBACK]: { color: '#6366f1', emoji: '🔄', title: 'OIDC Callback' },

  // Email events - Sky Blue
  [WebhookEvent.EMAIL_SENT]: { color: '#0ea5e9', emoji: '📧', title: 'Email Sent' },
  [WebhookEvent.EMAIL_TEMPLATE_UPDATED]: { color: '#0ea5e9', emoji: '✏️', title: 'Email Template Updated' },
  [WebhookEvent.EMAIL_FAILED]: { color: '#ef4444', emoji: '❌', title: 'Email Failed' },

  // Dashboard events - Gray
  [WebhookEvent.DASHBOARD_VIEWED]: { color: '#6b7280', emoji: '📊', title: 'Dashboard Viewed' },
  [WebhookEvent.DASHBOARD_STATS_CALCULATED]: {
    color: '#6b7280',
    emoji: '📈',
    title: 'Dashboard Stats Calculated',
  },
  [WebhookEvent.STATS_MONTHLY_REQUESTED]: { color: '#6b7280', emoji: '📊', title: 'Monthly Stats Requested' },
  [WebhookEvent.STATS_YEARLY_REQUESTED]: { color: '#6b7280', emoji: '📊', title: 'Yearly Stats Requested' },
  [WebhookEvent.CURRENCY_RATE_UPDATED]: { color: '#f59e0b', emoji: '💱', title: 'Currency Rate Updated' },

  // System events - Dark Gray
  [WebhookEvent.APP_RESET]: { color: '#ef4444', emoji: '🔄', title: 'App Reset' },
  [WebhookEvent.APP_ALL_DATA_RESET]: { color: '#ef4444', emoji: '⚠️', title: 'All Data Reset' },
  [WebhookEvent.OTP_REQUESTED]: { color: '#6b7280', emoji: '🔐', title: 'OTP Requested' },
  [WebhookEvent.OTP_VALIDATED]: { color: '#10b981', emoji: '✅', title: 'OTP Validated' },
  [WebhookEvent.OTP_EXPIRED]: { color: '#f59e0b', emoji: '⏰', title: 'OTP Expired' },

  // Search events
  [WebhookEvent.SEARCH_PERFORMED]: { color: '#6b7280', emoji: '🔍', title: 'Search Performed' },

  // File events
  [WebhookEvent.PDF_GENERATED]: { color: '#6366f1', emoji: '📄', title: 'PDF Generated' },
  [WebhookEvent.XML_GENERATED]: { color: '#6366f1', emoji: '📄', title: 'XML Generated' },
  [WebhookEvent.FILE_DOWNLOADED]: { color: '#6366f1', emoji: '📥', title: 'File Downloaded' },

  // Webhook events
  [WebhookEvent.WEBHOOK_CREATED]: { color: '#8b5cf6', emoji: '🪝', title: 'Webhook Created' },
  [WebhookEvent.WEBHOOK_UPDATED]: { color: '#8b5cf6', emoji: '✏️', title: 'Webhook Updated' },
  [WebhookEvent.WEBHOOK_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Webhook Deleted' },
  [WebhookEvent.WEBHOOK_TRIGGERED]: { color: '#10b981', emoji: '🔔', title: 'Webhook Triggered' },
  [WebhookEvent.WEBHOOK_FAILED]: { color: '#ef4444', emoji: '❌', title: 'Webhook Failed' },

  // Item events
  [WebhookEvent.QUOTE_ITEM_CREATED]: { color: '#3b82f6', emoji: '➕', title: 'Quote Item Created' },
  [WebhookEvent.QUOTE_ITEM_UPDATED]: { color: '#3b82f6', emoji: '✏️', title: 'Quote Item Updated' },
  [WebhookEvent.QUOTE_ITEM_DELETED]: { color: '#ef4444', emoji: '➖', title: 'Quote Item Deleted' },
  [WebhookEvent.INVOICE_ITEM_CREATED]: { color: '#10b981', emoji: '➕', title: 'Invoice Item Created' },
  [WebhookEvent.INVOICE_ITEM_UPDATED]: { color: '#10b981', emoji: '✏️', title: 'Invoice Item Updated' },
  [WebhookEvent.INVOICE_ITEM_DELETED]: { color: '#ef4444', emoji: '➖', title: 'Invoice Item Deleted' },
  [WebhookEvent.PAYMENT_ITEM_CREATED]: { color: '#8b5cf6', emoji: '➕', title: 'Payment Item Created' },
  [WebhookEvent.PAYMENT_ITEM_UPDATED]: { color: '#8b5cf6', emoji: '✏️', title: 'Payment Item Updated' },
  [WebhookEvent.PAYMENT_ITEM_DELETED]: { color: '#ef4444', emoji: '➖', title: 'Payment Item Deleted' },
  [WebhookEvent.RECEIPT_ITEM_CREATED]: { color: '#8b5cf6', emoji: '➕', title: 'Receipt Item Created' },
  [WebhookEvent.RECEIPT_ITEM_UPDATED]: { color: '#8b5cf6', emoji: '✏️', title: 'Receipt Item Updated' },
  [WebhookEvent.RECEIPT_ITEM_DELETED]: { color: '#ef4444', emoji: '➖', title: 'Receipt Item Deleted' },
  [WebhookEvent.RECURRING_INVOICE_ITEM_CREATED]: {
    color: '#06b6d4',
    emoji: '➕',
    title: 'Recurring Invoice Item Created',
  },
  [WebhookEvent.RECURRING_INVOICE_ITEM_UPDATED]: {
    color: '#06b6d4',
    emoji: '✏️',
    title: 'Recurring Invoice Item Updated',
  },
  [WebhookEvent.RECURRING_INVOICE_ITEM_DELETED]: {
    color: '#ef4444',
    emoji: '➖',
    title: 'Recurring Invoice Item Deleted',
  },

  // Config events
  [WebhookEvent.PDF_CONFIG_CREATED]: { color: '#6366f1', emoji: '⚙️', title: 'PDF Config Created' },
  [WebhookEvent.PDF_CONFIG_UPDATED]: { color: '#6366f1', emoji: '⚙️', title: 'PDF Config Updated' },
  [WebhookEvent.EMAIL_TEMPLATE_CREATED]: { color: '#0ea5e9', emoji: '📧', title: 'Email Template Created' },

  // Number formatting events
  [WebhookEvent.QUOTE_NUMBER_GENERATED]: { color: '#3b82f6', emoji: '🔢', title: 'Quote Number Generated' },
  [WebhookEvent.INVOICE_NUMBER_GENERATED]: {
    color: '#10b981',
    emoji: '🔢',
    title: 'Invoice Number Generated',
  },
  [WebhookEvent.PAYMENT_NUMBER_GENERATED]: {
    color: '#8b5cf6',
    emoji: '🔢',
    title: 'Payment Number Generated',
  },
  [WebhookEvent.RECEIPT_NUMBER_GENERATED]: {
    color: '#8b5cf6',
    emoji: '🔢',
    title: 'Receipt Number Generated',
  },

  // Background process events
  [WebhookEvent.CRON_JOB_STARTED]: { color: '#6b7280', emoji: '⏰', title: 'Cron Job Started' },
  [WebhookEvent.CRON_JOB_COMPLETED]: { color: '#10b981', emoji: '✅', title: 'Cron Job Completed' },
  [WebhookEvent.CRON_JOB_FAILED]: { color: '#ef4444', emoji: '❌', title: 'Cron Job Failed' },

  // Currency events
  [WebhookEvent.CURRENCY_CONVERSION_REQUESTED]: {
    color: '#f59e0b',
    emoji: '💱',
    title: 'Currency Conversion Requested',
  },
  [WebhookEvent.CURRENCY_RATE_FETCHED]: { color: '#f59e0b', emoji: '💱', title: 'Currency Rate Fetched' },

  // Mail template events
  [WebhookEvent.MAIL_TEMPLATE_CREATED]: { color: '#0ea5e9', emoji: '📧', title: 'Mail Template Created' },
  [WebhookEvent.MAIL_TEMPLATE_UPDATED]: { color: '#0ea5e9', emoji: '✏️', title: 'Mail Template Updated' },

  // SSE events
  [WebhookEvent.SSE_CONNECTION_ESTABLISHED]: {
    color: '#6b7280',
    emoji: '🔌',
    title: 'SSE Connection Established',
  },
  [WebhookEvent.SSE_DATA_STREAMED]: { color: '#6b7280', emoji: '📡', title: 'SSE Data Streamed' },

  // Validation events
  [WebhookEvent.DATA_VALIDATED]: { color: '#10b981', emoji: '✅', title: 'Data Validated' },
  [WebhookEvent.CONFIGURATION_VALIDATED]: { color: '#10b981', emoji: '✅', title: 'Configuration Validated' },
};

export function formatPayloadForEvent(event: WebhookEvent, payload: any): string {
  // Format specific data based on event type
  const formatters: Record<WebhookEvent, (p: any) => string | null> = {
    // Document events (generic, TODO_PRODUIT.md T2bis) — `documentLabel`/`documentNumber` (this
    // file's own header) read the uniform payload contract, so ONE formatter per event covers every
    // document type.
    [WebhookEvent.DOCUMENT_CREATED]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nCreated`,
    [WebhookEvent.DOCUMENT_SENT]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nSent`,
    [WebhookEvent.DOCUMENT_SEND_FAILED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n⚠️ Send failed: ${p.error || 'N/A'}`,
    [WebhookEvent.DOCUMENT_AUTHORITY_EVENT]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n🏛️ ${p.providerId || 'N/A'}: ${p.statusCode || 'N/A'}`,
    [WebhookEvent.DOCUMENT_DELETED]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nDeleted`,
    // TODO_PRODUIT.md T3 — `settlement` is the extra fact `buildDocumentWebhookPayload` carries for
    // this event (settlement/document-settled.ts's own `emitDocumentSettled`).
    [WebhookEvent.DOCUMENT_SETTLED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n✅ Settled (paid: ${p.settlement?.paidMinor ?? 'N/A'}, credited: ${p.settlement?.creditedMinor ?? 'N/A'})`,
    // TODO_CORRECTION.md C3 — see actions/invoice-actions.ts's own "cancel" handler.
    [WebhookEvent.DOCUMENT_CANCELLED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n🚫 Cancelled`,
    // Client events
    [WebhookEvent.CLIENT_CREATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}\nCity: ${p.client?.city || 'N/A'}`,
    [WebhookEvent.CLIENT_UPDATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}`,
    [WebhookEvent.CLIENT_DELETED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
    [WebhookEvent.CLIENT_ACTIVATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
    [WebhookEvent.CLIENT_DEACTIVATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
    [WebhookEvent.CLIENT_SEARCHED]: (_p) => null,

    // Company events
    [WebhookEvent.COMPANY_CREATED]: (p: { company: Company }) => `**${p.company?.name || 'N/A'}**`,
    [WebhookEvent.COMPANY_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nUpdate completed`,
    [WebhookEvent.COMPANY_PDF_CONFIG_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nPDF configuration updated`,
    [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nEmail template updated`,
    [WebhookEvent.COMPANY_INFO_VIEWED]: (_p) => null,

    // Recurring Invoice events
    [WebhookEvent.RECURRING_INVOICE_CREATED]: (p) =>
      `Client: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nFrequency: ${p.recurringInvoice?.frequency || 'N/A'}\nAmount: ${p.recurringInvoice?.totalTTC || 0}${p.recurringInvoice?.currency || '€'}`,
    [WebhookEvent.RECURRING_INVOICE_UPDATED]: (p) =>
      `Client: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}\nFrequency: ${p.recurringInvoice?.frequency || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_DELETED]: (p) =>
      `Client: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_GENERATED]: (p) =>
      `Recurring invoice generated\nClient: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_AUTO_SENT]: (p) =>
      `Recurring invoice auto-sent\nClient: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_PROCESSED]: (p) =>
      `Recurring invoice processed\nClient: ${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_NEXT_DATE_CALCULATED]: (p) =>
      `Next date: ${p.nextDate ? new Date(p.nextDate).toLocaleDateString('en-US') : 'N/A'}`,

    // Plugin events
    [WebhookEvent.PLUGIN_ACTIVATED]: (p) =>
      `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
    [WebhookEvent.PLUGIN_DEACTIVATED]: (p) =>
      `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
    [WebhookEvent.PLUGIN_CONFIGURED]: (p) => `**${p.plugin?.name || 'N/A'}**\nConfiguration updated`,
    [WebhookEvent.PLUGIN_ADDED]: (p) => `**${p.plugin?.name || 'N/A'}**\nType: ${p.plugin?.type || 'N/A'}`,
    [WebhookEvent.PLUGIN_REMOVED]: (p) => `**${p.plugin?.name || 'N/A'}**`,
    [WebhookEvent.PLUGIN_VALIDATED]: (p) => `**${p.plugin?.name || 'N/A'}**`,
    [WebhookEvent.PLUGIN_PROVIDER_REQUESTED]: (_p) => null,
    [WebhookEvent.PLUGIN_FORMAT_REQUESTED]: (_p) => null,
    [WebhookEvent.PLUGIN_WEBHOOK_RECEIVED]: (p) => `Plugin: ${p.plugin?.name || 'N/A'}`,

    // Authentication events
    [WebhookEvent.USER_CREATED]: (p) =>
      `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_UPDATED]: (p) =>
      `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_LOGGED_IN]: (p) => `👤 ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_PASSWORD_CHANGED]: (p) => `User: ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_PROFILE_UPDATED]: (p) =>
      `**${p.user?.firstname} ${p.user?.lastname}**\nEmail: ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_OIDC_LOGIN]: (p) => `👤 ${p.user?.email || 'N/A'}`,
    [WebhookEvent.USER_OIDC_CALLBACK]: (_p) => null,

    // Email events
    [WebhookEvent.EMAIL_SENT]: (p) => `To: ${p.to || 'N/A'}\nSubject: ${p.subject || 'N/A'}`,
    [WebhookEvent.EMAIL_TEMPLATE_UPDATED]: (p) => `Template: ${p.template?.name || 'N/A'}`,
    [WebhookEvent.EMAIL_FAILED]: (p) => `To: ${p.to || 'N/A'}\nError: ${p.error || 'N/A'}`,

    // Dashboard events
    [WebhookEvent.DASHBOARD_VIEWED]: (_p) => null,
    [WebhookEvent.DASHBOARD_STATS_CALCULATED]: (_p) => null,
    [WebhookEvent.STATS_MONTHLY_REQUESTED]: (_p) => null,
    [WebhookEvent.STATS_YEARLY_REQUESTED]: (_p) => null,
    [WebhookEvent.CURRENCY_RATE_UPDATED]: (p) => `Currency: ${p.currency || 'N/A'}\nRate: ${p.rate || 'N/A'}`,

    // System events
    [WebhookEvent.APP_RESET]: (_p) => null,
    [WebhookEvent.APP_ALL_DATA_RESET]: (_p) => null,
    [WebhookEvent.OTP_REQUESTED]: (_p) => null,
    [WebhookEvent.OTP_VALIDATED]: (_p) => null,
    [WebhookEvent.OTP_EXPIRED]: (_p) => null,

    // Search events
    [WebhookEvent.SEARCH_PERFORMED]: (_p) => null,

    // File events
    [WebhookEvent.PDF_GENERATED]: (_p) => null,
    [WebhookEvent.XML_GENERATED]: (_p) => null,
    [WebhookEvent.FILE_DOWNLOADED]: (_p) => null,

    // Webhook events
    [WebhookEvent.WEBHOOK_CREATED]: (p) =>
      `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
    [WebhookEvent.WEBHOOK_UPDATED]: (p) =>
      `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
    [WebhookEvent.WEBHOOK_DELETED]: (p) => `Type: ${p.webhook?.type || 'N/A'}`,
    [WebhookEvent.WEBHOOK_TRIGGERED]: (p) => `Type: ${p.webhook?.type || 'N/A'}`,
    [WebhookEvent.WEBHOOK_FAILED]: (p) => `❌ URL: ${p.webhook?.url || 'N/A'}\nError: ${p.error || 'N/A'}`,

    // Item events
    [WebhookEvent.QUOTE_ITEM_CREATED]: (p) =>
      `Quote: #${p.quote?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.QUOTE_ITEM_UPDATED]: (p) =>
      `Quote: #${p.quote?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.QUOTE_ITEM_DELETED]: (p) => `Quote: #${p.quote?.number || 'N/A'}`,
    [WebhookEvent.INVOICE_ITEM_CREATED]: (p) =>
      `Invoice: #${p.invoice?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.INVOICE_ITEM_UPDATED]: (p) =>
      `Invoice: #${p.invoice?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.INVOICE_ITEM_DELETED]: (p) => `Invoice: #${p.invoice?.number || 'N/A'}`,
    [WebhookEvent.PAYMENT_ITEM_CREATED]: (p) =>
      `Payment: #${p.payment?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.PAYMENT_ITEM_UPDATED]: (p) =>
      `Payment: #${p.payment?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.PAYMENT_ITEM_DELETED]: (p) => `Payment: #${p.payment?.number || 'N/A'}`,
    [WebhookEvent.RECEIPT_ITEM_CREATED]: (p) =>
      `Receipt: #${p.receipt?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.RECEIPT_ITEM_UPDATED]: (p) =>
      `Receipt: #${p.receipt?.number || 'N/A'}\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.RECEIPT_ITEM_DELETED]: (p) => `Receipt: #${p.receipt?.number || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_ITEM_CREATED]: (p) => `Recurring Invoice\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_ITEM_UPDATED]: (p) => `Recurring Invoice\nItem: ${p.item?.name || 'N/A'}`,
    [WebhookEvent.RECURRING_INVOICE_ITEM_DELETED]: (_p) => `Recurring Invoice`,

    // Config events
    [WebhookEvent.PDF_CONFIG_CREATED]: (p) => `Company: ${p.company?.name || 'N/A'}`,
    [WebhookEvent.PDF_CONFIG_UPDATED]: (p) => `Company: ${p.company?.name || 'N/A'}`,
    [WebhookEvent.EMAIL_TEMPLATE_CREATED]: (p) => `Template: ${p.template?.name || 'N/A'}`,

    // Number formatting events
    [WebhookEvent.QUOTE_NUMBER_GENERATED]: (p) => `Quote number: ${p.number || 'N/A'}`,
    [WebhookEvent.INVOICE_NUMBER_GENERATED]: (p) => `Invoice number: ${p.number || 'N/A'}`,
    [WebhookEvent.PAYMENT_NUMBER_GENERATED]: (p) => `Payment number: ${p.number || 'N/A'}`,
    [WebhookEvent.RECEIPT_NUMBER_GENERATED]: (p) => `Receipt number: ${p.number || 'N/A'}`,

    // Background process events
    [WebhookEvent.CRON_JOB_STARTED]: (p) => `Job: ${p.jobName || 'N/A'}`,
    [WebhookEvent.CRON_JOB_COMPLETED]: (p) => `Job: ${p.jobName || 'N/A'}`,
    [WebhookEvent.CRON_JOB_FAILED]: (p) => `Job: ${p.jobName || 'N/A'}\nError: ${p.error || 'N/A'}`,

    // Currency events
    [WebhookEvent.CURRENCY_CONVERSION_REQUESTED]: (p) =>
      `From: ${p.from || 'N/A'}\nTo: ${p.to || 'N/A'}\nAmount: ${p.amount || 0}`,
    [WebhookEvent.CURRENCY_RATE_FETCHED]: (p) => `Currency: ${p.currency || 'N/A'}\nRate: ${p.rate || 'N/A'}`,

    // Mail template events
    [WebhookEvent.MAIL_TEMPLATE_CREATED]: (p) => `Template: ${p.template?.name || 'N/A'}`,
    [WebhookEvent.MAIL_TEMPLATE_UPDATED]: (p) => `Template: ${p.template?.name || 'N/A'}`,

    // SSE events
    [WebhookEvent.SSE_CONNECTION_ESTABLISHED]: (_p) => null,
    [WebhookEvent.SSE_DATA_STREAMED]: (_p) => null,

    // Validation events
    [WebhookEvent.DATA_VALIDATED]: (_p) => null,
    [WebhookEvent.CONFIGURATION_VALIDATED]: (_p) => null,
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

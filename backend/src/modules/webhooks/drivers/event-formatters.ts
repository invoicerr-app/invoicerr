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
 *
 * TODO_SUITE.md P3 (2026-09-03) — the CLIENT_ACTIVATED, CLIENT_DEACTIVATED, COMPANY_PDF_CONFIG_UPDATED,
 * COMPANY_INFO_VIEWED, WEBHOOK_TRIGGERED, WEBHOOK_FAILED, and every RECURRING_INVOICE_, PLUGIN_,
 * USER_, EMAIL_, DASHBOARD_, etc. entry this file used to carry are GONE THE SAME WAY: each had a
 * style AND a formatter here despite dispatching NOTHING, ever (see the migration's own header for
 * the full per-family grep proof) — dead weight for an event no webhook could ever actually receive.
 * `EVENT_STYLES`/`formatters` below are `Record<WebhookEvent, ...>`, so TypeScript itself now
 * enforces the invariant this purge restores: exactly one style and one formatter per LIVE event, no
 * more, no less — the compiler errors if a future enum member is added here without a mapping, or if
 * a stale mapping outlives its enum member.
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

  // Client events - Pink (TODO_SUITE.md P3 — only the four with a real emitter, see schema.prisma's
  // own comment on this enum for the CLIENT_ACTIVATED/CLIENT_DEACTIVATED purge)
  [WebhookEvent.CLIENT_CREATED]: { color: '#ec4899', emoji: '👤', title: 'Client Created' },
  [WebhookEvent.CLIENT_UPDATED]: { color: '#ec4899', emoji: '✏️', title: 'Client Updated' },
  [WebhookEvent.CLIENT_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Client Deleted' },
  [WebhookEvent.CLIENT_SEARCHED]: { color: '#6b7280', emoji: '🔍', title: 'Client Searched' },

  // Company events - Orange (TODO_SUITE.md P3 — only the three with a real emitter, see
  // schema.prisma's own comment on this enum for the COMPANY_PDF_CONFIG_UPDATED/COMPANY_INFO_VIEWED
  // purge)
  [WebhookEvent.COMPANY_CREATED]: { color: '#f97316', emoji: '🏢', title: 'Company Created' },
  [WebhookEvent.COMPANY_UPDATED]: { color: '#f97316', emoji: '✏️', title: 'Company Updated' },
  [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: {
    color: '#f97316',
    emoji: '📧',
    title: 'Email Template Updated',
  },

  // Webhook events - Purple (TODO_SUITE.md P3 — only the three lifecycle events on the subscription
  // row itself, see schema.prisma's own comment on this enum for the WEBHOOK_TRIGGERED/WEBHOOK_FAILED
  // purge)
  [WebhookEvent.WEBHOOK_CREATED]: { color: '#8b5cf6', emoji: '🪝', title: 'Webhook Created' },
  [WebhookEvent.WEBHOOK_UPDATED]: { color: '#8b5cf6', emoji: '✏️', title: 'Webhook Updated' },
  [WebhookEvent.WEBHOOK_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Webhook Deleted' },
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

    // Client events (TODO_SUITE.md P3 — only the four with a real emitter)
    [WebhookEvent.CLIENT_CREATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}\nCity: ${p.client?.city || 'N/A'}`,
    [WebhookEvent.CLIENT_UPDATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}`,
    [WebhookEvent.CLIENT_DELETED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : p.client?.contactFirstname + ' ' + p.client?.contactLastname) || 'N/A'}**`,
    [WebhookEvent.CLIENT_SEARCHED]: (_p) => null,

    // Company events (TODO_SUITE.md P3 — only the three with a real emitter)
    [WebhookEvent.COMPANY_CREATED]: (p: { company: Company }) => `**${p.company?.name || 'N/A'}**`,
    [WebhookEvent.COMPANY_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nUpdate completed`,
    [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nEmail template updated`,

    // Webhook events (TODO_SUITE.md P3 — only the three lifecycle events on the subscription row)
    [WebhookEvent.WEBHOOK_CREATED]: (p) =>
      `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
    [WebhookEvent.WEBHOOK_UPDATED]: (p) =>
      `Type: ${p.webhook?.type || 'N/A'}\nURL: ${p.webhook?.url || 'N/A'}`,
    [WebhookEvent.WEBHOOK_DELETED]: (p) => `Type: ${p.webhook?.type || 'N/A'}`,
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

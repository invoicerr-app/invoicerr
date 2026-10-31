import { Company, WebhookEvent } from '../../../../prisma/generated/prisma/client';

/**
 * Event styles and message formatters for the live webhook events. Both records are typed
 * `Record<WebhookEvent, ...>`, so the compiler requires exactly one entry per enum member.
 * `documentLabel`/`documentNumber` read the uniform payload contract from
 * `queue/document-webhooks.ts#buildDocumentWebhookPayload`, so one formatter per `DOCUMENT_*` event
 * covers every document type.
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
  // Document events - Green (generic)
  [WebhookEvent.DOCUMENT_CREATED]: { color: '#10b981', emoji: '🆕', title: 'Document Created' },
  [WebhookEvent.DOCUMENT_SENT]: { color: '#10b981', emoji: '📤', title: 'Document Sent' },
  [WebhookEvent.DOCUMENT_SEND_FAILED]: { color: '#ef4444', emoji: '⚠️', title: 'Document Send Failed' },
  [WebhookEvent.DOCUMENT_AUTHORITY_EVENT]: { color: '#6366f1', emoji: '🏛️', title: 'Authority Event' },
  [WebhookEvent.DOCUMENT_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Document Deleted' },
  // See settlement/document-settled.ts for when this fires.
  [WebhookEvent.DOCUMENT_SETTLED]: { color: '#10b981', emoji: '✅', title: 'Document Settled' },
  // See actions/invoice-actions.ts's "cancel" handler for when this fires.
  [WebhookEvent.DOCUMENT_CANCELLED]: { color: '#ef4444', emoji: '🚫', title: 'Document Cancelled' },
  // Fires from the public OTP-verification flow, never an authenticated action.
  [WebhookEvent.DOCUMENT_SIGNED]: { color: '#10b981', emoji: '✍️', title: 'Document Signed' },

  // Client events - Pink
  [WebhookEvent.CLIENT_CREATED]: { color: '#ec4899', emoji: '👤', title: 'Client Created' },
  [WebhookEvent.CLIENT_UPDATED]: { color: '#ec4899', emoji: '✏️', title: 'Client Updated' },
  [WebhookEvent.CLIENT_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Client Deleted' },
  [WebhookEvent.CLIENT_SEARCHED]: { color: '#6b7280', emoji: '🔍', title: 'Client Searched' },

  // Company events - Orange
  [WebhookEvent.COMPANY_CREATED]: { color: '#f97316', emoji: '🏢', title: 'Company Created' },
  [WebhookEvent.COMPANY_UPDATED]: { color: '#f97316', emoji: '✏️', title: 'Company Updated' },
  [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: {
    color: '#f97316',
    emoji: '📧',
    title: 'Email Template Updated',
  },

  // Webhook events - Purple
  [WebhookEvent.WEBHOOK_CREATED]: { color: '#8b5cf6', emoji: '🪝', title: 'Webhook Created' },
  [WebhookEvent.WEBHOOK_UPDATED]: { color: '#8b5cf6', emoji: '✏️', title: 'Webhook Updated' },
  [WebhookEvent.WEBHOOK_DELETED]: { color: '#ef4444', emoji: '🗑️', title: 'Webhook Deleted' },
};

export function formatPayloadForEvent(event: WebhookEvent, payload: any): string {
  const formatters: Record<WebhookEvent, (p: any) => string | null> = {
    // Document events (generic)
    [WebhookEvent.DOCUMENT_CREATED]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nCreated`,
    [WebhookEvent.DOCUMENT_SENT]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nSent`,
    [WebhookEvent.DOCUMENT_SEND_FAILED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n⚠️ Send failed: ${p.error || 'N/A'}`,
    [WebhookEvent.DOCUMENT_AUTHORITY_EVENT]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n🏛️ ${p.providerId || 'N/A'}: ${p.statusCode || 'N/A'}`,
    [WebhookEvent.DOCUMENT_DELETED]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\nDeleted`,
    // `settlement` is the extra fact the payload carries for this event.
    [WebhookEvent.DOCUMENT_SETTLED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n✅ Settled (paid: ${p.settlement?.paidMinor ?? 'N/A'}, credited: ${p.settlement?.creditedMinor ?? 'N/A'})`,
    [WebhookEvent.DOCUMENT_CANCELLED]: (p) =>
      `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n🚫 Cancelled`,
    [WebhookEvent.DOCUMENT_SIGNED]: (p) => `**${documentLabel(p.typeId)} #${documentNumber(p)}**\n✍️ Signed`,

    // Client events
    [WebhookEvent.CLIENT_CREATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : `${p.client?.contactFirstname} ${p.client?.contactLastname}`) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}\nCity: ${p.client?.city || 'N/A'}`,
    [WebhookEvent.CLIENT_UPDATED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : `${p.client?.contactFirstname} ${p.client?.contactLastname}`) || 'N/A'}**\nEmail: ${p.client?.contactEmail || 'N/A'}`,
    [WebhookEvent.CLIENT_DELETED]: (p) =>
      `**${(p.client?.type === 'COMPANY' ? p.client?.name : `${p.client?.contactFirstname} ${p.client?.contactLastname}`) || 'N/A'}**`,
    [WebhookEvent.CLIENT_SEARCHED]: (_p) => null,

    // Company events
    [WebhookEvent.COMPANY_CREATED]: (p: { company: Company }) => `**${p.company?.name || 'N/A'}**`,
    [WebhookEvent.COMPANY_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nUpdate completed`,
    [WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED]: (p: { company: Company }) =>
      `**${p.company?.name || 'N/A'}**\nEmail template updated`,

    // Webhook events
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
    } catch (_error) {
      return `Data: ${JSON.stringify(payload, null, 2).substring(0, 500)}`;
    }
  }

  return `Event triggered successfully`;
}

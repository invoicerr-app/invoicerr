import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { EVENT_STYLES } from './drivers/event-formatters';

/**
 * Pins the WebhookEvent enum to the members that have a real emitter: it fails the moment one is added,
 * removed or reordered. This also protects the options endpoint and the `EVENT_STYLES`/formatter records
 * keyed on the enum.
 */
describe('WebhookEvent enum (the post-purge pin)', () => {
  // Order matches the enum declaration in schema.prisma, which also pins the order the settings screen
  // renders the event picker in.
  const EXPECTED_EVENTS = [
    'DOCUMENT_CREATED',
    'DOCUMENT_SENT',
    'DOCUMENT_SEND_FAILED',
    'DOCUMENT_AUTHORITY_EVENT',
    'DOCUMENT_DELETED',
    'DOCUMENT_SETTLED',
    'DOCUMENT_CANCELLED',
    // Fires from the public OTP-verification flow.
    'DOCUMENT_SIGNED',
    'CLIENT_CREATED',
    'CLIENT_UPDATED',
    'CLIENT_DELETED',
    'CLIENT_SEARCHED',
    'COMPANY_CREATED',
    'COMPANY_UPDATED',
    'COMPANY_EMAIL_TEMPLATE_UPDATED',
    'WEBHOOK_CREATED',
    'WEBHOOK_UPDATED',
    'WEBHOOK_DELETED',
  ];

  it('carries exactly the 18 members with a real emitter — nothing purged survives, nothing new sneaks in', () => {
    expect(Object.values(WebhookEvent)).toEqual(EXPECTED_EVENTS);
  });

  it('does not resurrect any of the 79 members purged on 2026-09-03', () => {
    const purged = [
      // Removed alongside their surviving siblings.
      'CLIENT_ACTIVATED',
      'CLIENT_DEACTIVATED',
      'COMPANY_PDF_CONFIG_UPDATED',
      'COMPANY_INFO_VIEWED',
      'WEBHOOK_TRIGGERED',
      'WEBHOOK_FAILED',
      // One representative per other removed family.
      'RECURRING_INVOICE_CREATED',
      'RECURRING_INVOICE_ITEM_CREATED',
      'PLUGIN_WEBHOOK_RECEIVED',
      'USER_CREATED',
      'OTP_REQUESTED',
      'APP_RESET',
      'EMAIL_SENT',
      'MAIL_TEMPLATE_CREATED',
      'DASHBOARD_VIEWED',
      'STATS_MONTHLY_REQUESTED',
      'CURRENCY_RATE_UPDATED',
      'SEARCH_PERFORMED',
      'PDF_GENERATED',
      'QUOTE_ITEM_CREATED',
      'INVOICE_ITEM_CREATED',
      'PAYMENT_ITEM_CREATED',
      'RECEIPT_ITEM_CREATED',
      'PDF_CONFIG_CREATED',
      'EMAIL_TEMPLATE_CREATED',
      'QUOTE_NUMBER_GENERATED',
      'CRON_JOB_STARTED',
      'SSE_CONNECTION_ESTABLISHED',
      'DATA_VALIDATED',
      'CONFIGURATION_VALIDATED',
    ];
    for (const value of purged) {
      expect(Object.values(WebhookEvent)).not.toContain(value);
    }
  });

  it('EVENT_STYLES carries exactly one style per live event — no more, no less', () => {
    expect(Object.keys(EVENT_STYLES).sort()).toEqual([...Object.values(WebhookEvent)].sort());
  });
});

import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { EVENT_STYLES } from './drivers/event-formatters';

/**
 * TODO_SUITE.md P3 (2026-09-03) — pins the WebhookEvent enum to the exact list this task's grep
 * proved alive (see the migration's own header, `20260903200000_purge_dead_webhook_events`, for the
 * per-family evidence). This is the tripwire the task asked for: it fails LOUDLY the moment anyone —
 * this task included, if it had gotten the list wrong — adds, removes, or reorders a WebhookEvent
 * member without updating this list AND its own justification (a real dispatch call site, proven by
 * grep, or an explicit decision recorded the way this task's own migration header records one).
 *
 * `Object.values(WebhookEvent)` is exactly what `GET /api/webhooks/options` returns to the screen
 * (`webhooks.controller.ts#options`) and what `EVENT_STYLES`/`formatPayloadForEvent`
 * (`drivers/event-formatters.ts`) key their `Record<WebhookEvent, ...>` on — so this single pin
 * indirectly protects all three from drifting apart.
 */
describe('WebhookEvent enum (TODO_SUITE.md P3 — the post-purge pin)', () => {
  // Order matches the enum's own declaration in schema.prisma exactly — Object.values on a TS
  // `as const` object preserves insertion order, so this also pins the *order* the settings screen
  // renders the event picker in, not merely its membership.
  const EXPECTED_EVENTS = [
    'DOCUMENT_CREATED',
    'DOCUMENT_SENT',
    'DOCUMENT_SEND_FAILED',
    'DOCUMENT_AUTHORITY_EVENT',
    'DOCUMENT_DELETED',
    'DOCUMENT_SETTLED',
    'DOCUMENT_CANCELLED',
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

  it('carries exactly the 17 members with a real emitter — nothing purged survives, nothing new sneaks in', () => {
    expect(Object.values(WebhookEvent)).toEqual(EXPECTED_EVENTS);
  });

  it('does not resurrect any of the 79 members purged by TODO_SUITE.md P3', () => {
    const purged = [
      // Client / Company / Webhook families — the ones purged alongside their surviving siblings.
      'CLIENT_ACTIVATED',
      'CLIENT_DEACTIVATED',
      'COMPANY_PDF_CONFIG_UPDATED',
      'COMPANY_INFO_VIEWED',
      'WEBHOOK_TRIGGERED',
      'WEBHOOK_FAILED',
      // A representative of every other purged family — the exhaustive 79-value list lives in the
      // migration's own header; this spot-checks each family rather than repeating it verbatim.
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

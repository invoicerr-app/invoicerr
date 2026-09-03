/*
  TODO_SUITE.md P3 (2026-09-03) — the mine-d'ordre lesson from
  20260903170000_restore_document_settled_after_enum_rebuild applied IN REVERSE: this migration is
  timestamped AFTER every migration in this repository that ADDS a WebhookEvent value
  (20260902234040_payment_conversion_and_document_settled's DOCUMENT_SETTLED,
  20260903180000_add_document_cancelled_webhook_event's DOCUMENT_CANCELLED), so the CREATE TYPE
  below carries BOTH of those forward — a fresh database replays migrations in LEXICOGRAPHIC
  timestamp order, never commit order, and a rebuild that forgot a value added by an
  earlier-alphabetically migration would silently destroy it on that fresh database exactly the
  way the mine did. There is no equivalent risk the other way for THIS migration, because nothing
  in this repository is timestamped between 20260903180000 and this file.

  Purges 79 further WebhookEvent members with NO real emitter anywhere in backend/src — the
  "soixantaine de valeurs supplémentaires tout aussi mortes" TODO_ISSUES.md flagged when
  20260903000000_generic_document_webhook_events (T2bis) purged the per-type document families and
  deliberately left CLIENT_*, COMPANY_*, WEBHOOK_* and the rest "hors périmètre" for a separate decision. That
  decision is this migration. Method: grep, one enum member at a time, for every dispatch call site
  (`WebhookDispatcherService.dispatch(WebhookEvent.X, ...)` and the `DocumentWebhookEmitter.dispatch`
  callers that mirror it — `actions/async-send.ts`, `actions/generic-actions.ts`,
  `actions/invoice-actions.ts`, `queue/document-authority-webhook.ts`, `queue/mark-send-failed.ts`,
  `settlement/document-settled.ts`) across backend/src, excluding `event-formatters.ts` (styles/
  formatters exist for members that were never fired — that is exactly the dead weight being
  removed), `*.spec.ts`, and the generated Prisma client. Literal AND dynamic dispatch both checked;
  no call site anywhere builds a WebhookEvent value programmatically (every dispatch call passes a
  bare `WebhookEvent.X` literal), so a literal grep is exhaustive here, not merely a spot check. Full
  per-value table (kept-with-proof / purged) is in the task's own report; the shape of what survives
  and what does not:

    - CLIENT_* (6 members): only CREATED/UPDATED/DELETED/SEARCHED have an emitter
      (`clients.service.ts`) — ACTIVATED/DEACTIVATED purged, the "isActive" toggle dispatches
      through the ordinary CLIENT_UPDATED, there never was a dedicated event for it.
    - COMPANY_* (5 members): only CREATED/UPDATED/EMAIL_TEMPLATE_UPDATED have an emitter
      (`company.service.ts`) — PDF_CONFIG_UPDATED/INFO_VIEWED purged, never dispatched.
    - WEBHOOK_* (5 members): only CREATED/UPDATED/DELETED have an emitter (`webhooks.controller.ts`,
      on the subscription row itself) — TRIGGERED/FAILED purged, a delivery attempt's outcome is
      logged (`webhooks.service.ts#send`), never turned into a self-referential webhook event.
    - PLUGIN_* (9 members, all purged): TODO_SUITE.md P2 removed the external plugin mechanism;
      `plugins.controller.ts` exposes no inbound webhook route at all, so PLUGIN_WEBHOOK_RECEIVED —
      the one member that could plausibly have a real trigger — never had one either.
    - RECURRING_INVOICE_* (10 members incl. 3 item events, all purged): there is no `RecurringInvoice`
      Prisma model any more — the feature is the generic document `schedule/cadence.ts` today.
    - Every remaining family (USER_*, OTP_*, APP_*, EMAIL_*, MAIL_TEMPLATE_*, DASHBOARD_*, STATS_*,
      CURRENCY_*, SEARCH_PERFORMED, PDF_GENERATED/XML_GENERATED/FILE_DOWNLOADED, every *_ITEM_*
      member, PDF_CONFIG_*, EMAIL_TEMPLATE_CREATED, every *_NUMBER_GENERATED member, CRON_JOB_*,
      SSE_*, DATA_VALIDATED, CONFIGURATION_VALIDATED — 44 members): zero dispatch call sites, full
      stop. These enum members trace back to the very first webhook module and were seemingly
      written to cover concepts the product later never wired a dispatcher for.

  Postgres cannot ALTER TYPE ... DROP VALUE — the only way to remove enum members is the same
  rebuild dance as T2bis and 20251127192241_remove_unexisting_plugins_types before it: CREATE the
  new type, cast the column across, rename, drop the old type. "Webhook"."events" is a
  WebhookEvent[]; an existing subscription can reference any of the 79 purged values, so Step 1
  cleans those out of every "events" array BEFORE the type swap — exactly the same reasoning
  T2bis's own header spells out: a value absent from the new enum makes the cast in Step 2 fail
  outright, on any base that ever had a webhook subscribed to one of these dead events.
*/

-- Etape 1 : nettoie les abonnements EXISTANTS qui referencent une des 79 valeurs sur le point d'etre
-- purgees — retire seulement ces valeurs-la du tableau "events" de chaque webhook concerne, laisse
-- tout le reste du tableau intact (un webhook qui suivait aussi DOCUMENT_SENT garde DOCUMENT_SENT).
UPDATE "Webhook"
SET "events" = (
  SELECT COALESCE(array_agg(e ORDER BY ord), ARRAY[]::"WebhookEvent"[])
  FROM unnest("events") WITH ORDINALITY AS u(e, ord)
  WHERE e::text NOT IN ('APP_ALL_DATA_RESET', 'APP_RESET', 'CLIENT_ACTIVATED', 'CLIENT_DEACTIVATED', 'COMPANY_INFO_VIEWED', 'COMPANY_PDF_CONFIG_UPDATED', 'CONFIGURATION_VALIDATED', 'CRON_JOB_COMPLETED', 'CRON_JOB_FAILED', 'CRON_JOB_STARTED', 'CURRENCY_CONVERSION_REQUESTED', 'CURRENCY_RATE_FETCHED', 'CURRENCY_RATE_UPDATED', 'DASHBOARD_STATS_CALCULATED', 'DASHBOARD_VIEWED', 'DATA_VALIDATED', 'EMAIL_FAILED', 'EMAIL_SENT', 'EMAIL_TEMPLATE_CREATED', 'EMAIL_TEMPLATE_UPDATED', 'FILE_DOWNLOADED', 'INVOICE_ITEM_CREATED', 'INVOICE_ITEM_DELETED', 'INVOICE_ITEM_UPDATED', 'INVOICE_NUMBER_GENERATED', 'MAIL_TEMPLATE_CREATED', 'MAIL_TEMPLATE_UPDATED', 'OTP_EXPIRED', 'OTP_REQUESTED', 'OTP_VALIDATED', 'PAYMENT_ITEM_CREATED', 'PAYMENT_ITEM_DELETED', 'PAYMENT_ITEM_UPDATED', 'PAYMENT_NUMBER_GENERATED', 'PDF_CONFIG_CREATED', 'PDF_CONFIG_UPDATED', 'PDF_GENERATED', 'PLUGIN_ACTIVATED', 'PLUGIN_ADDED', 'PLUGIN_CONFIGURED', 'PLUGIN_DEACTIVATED', 'PLUGIN_FORMAT_REQUESTED', 'PLUGIN_PROVIDER_REQUESTED', 'PLUGIN_REMOVED', 'PLUGIN_VALIDATED', 'PLUGIN_WEBHOOK_RECEIVED', 'QUOTE_ITEM_CREATED', 'QUOTE_ITEM_DELETED', 'QUOTE_ITEM_UPDATED', 'QUOTE_NUMBER_GENERATED', 'RECEIPT_ITEM_CREATED', 'RECEIPT_ITEM_DELETED', 'RECEIPT_ITEM_UPDATED', 'RECEIPT_NUMBER_GENERATED', 'RECURRING_INVOICE_AUTO_SENT', 'RECURRING_INVOICE_CREATED', 'RECURRING_INVOICE_DELETED', 'RECURRING_INVOICE_GENERATED', 'RECURRING_INVOICE_ITEM_CREATED', 'RECURRING_INVOICE_ITEM_DELETED', 'RECURRING_INVOICE_ITEM_UPDATED', 'RECURRING_INVOICE_NEXT_DATE_CALCULATED', 'RECURRING_INVOICE_PROCESSED', 'RECURRING_INVOICE_UPDATED', 'SEARCH_PERFORMED', 'SSE_CONNECTION_ESTABLISHED', 'SSE_DATA_STREAMED', 'STATS_MONTHLY_REQUESTED', 'STATS_YEARLY_REQUESTED', 'USER_CREATED', 'USER_LOGGED_IN', 'USER_OIDC_CALLBACK', 'USER_OIDC_LOGIN', 'USER_PASSWORD_CHANGED', 'USER_PROFILE_UPDATED', 'USER_UPDATED', 'WEBHOOK_FAILED', 'WEBHOOK_TRIGGERED', 'XML_GENERATED')
)
WHERE "events" && ARRAY['APP_ALL_DATA_RESET'::"WebhookEvent", 'APP_RESET'::"WebhookEvent", 'CLIENT_ACTIVATED'::"WebhookEvent", 'CLIENT_DEACTIVATED'::"WebhookEvent", 'COMPANY_INFO_VIEWED'::"WebhookEvent", 'COMPANY_PDF_CONFIG_UPDATED'::"WebhookEvent", 'CONFIGURATION_VALIDATED'::"WebhookEvent", 'CRON_JOB_COMPLETED'::"WebhookEvent", 'CRON_JOB_FAILED'::"WebhookEvent", 'CRON_JOB_STARTED'::"WebhookEvent", 'CURRENCY_CONVERSION_REQUESTED'::"WebhookEvent", 'CURRENCY_RATE_FETCHED'::"WebhookEvent", 'CURRENCY_RATE_UPDATED'::"WebhookEvent", 'DASHBOARD_STATS_CALCULATED'::"WebhookEvent", 'DASHBOARD_VIEWED'::"WebhookEvent", 'DATA_VALIDATED'::"WebhookEvent", 'EMAIL_FAILED'::"WebhookEvent", 'EMAIL_SENT'::"WebhookEvent", 'EMAIL_TEMPLATE_CREATED'::"WebhookEvent", 'EMAIL_TEMPLATE_UPDATED'::"WebhookEvent", 'FILE_DOWNLOADED'::"WebhookEvent", 'INVOICE_ITEM_CREATED'::"WebhookEvent", 'INVOICE_ITEM_DELETED'::"WebhookEvent", 'INVOICE_ITEM_UPDATED'::"WebhookEvent", 'INVOICE_NUMBER_GENERATED'::"WebhookEvent", 'MAIL_TEMPLATE_CREATED'::"WebhookEvent", 'MAIL_TEMPLATE_UPDATED'::"WebhookEvent", 'OTP_EXPIRED'::"WebhookEvent", 'OTP_REQUESTED'::"WebhookEvent", 'OTP_VALIDATED'::"WebhookEvent", 'PAYMENT_ITEM_CREATED'::"WebhookEvent", 'PAYMENT_ITEM_DELETED'::"WebhookEvent", 'PAYMENT_ITEM_UPDATED'::"WebhookEvent", 'PAYMENT_NUMBER_GENERATED'::"WebhookEvent", 'PDF_CONFIG_CREATED'::"WebhookEvent", 'PDF_CONFIG_UPDATED'::"WebhookEvent", 'PDF_GENERATED'::"WebhookEvent", 'PLUGIN_ACTIVATED'::"WebhookEvent", 'PLUGIN_ADDED'::"WebhookEvent", 'PLUGIN_CONFIGURED'::"WebhookEvent", 'PLUGIN_DEACTIVATED'::"WebhookEvent", 'PLUGIN_FORMAT_REQUESTED'::"WebhookEvent", 'PLUGIN_PROVIDER_REQUESTED'::"WebhookEvent", 'PLUGIN_REMOVED'::"WebhookEvent", 'PLUGIN_VALIDATED'::"WebhookEvent", 'PLUGIN_WEBHOOK_RECEIVED'::"WebhookEvent", 'QUOTE_ITEM_CREATED'::"WebhookEvent", 'QUOTE_ITEM_DELETED'::"WebhookEvent", 'QUOTE_ITEM_UPDATED'::"WebhookEvent", 'QUOTE_NUMBER_GENERATED'::"WebhookEvent", 'RECEIPT_ITEM_CREATED'::"WebhookEvent", 'RECEIPT_ITEM_DELETED'::"WebhookEvent", 'RECEIPT_ITEM_UPDATED'::"WebhookEvent", 'RECEIPT_NUMBER_GENERATED'::"WebhookEvent", 'RECURRING_INVOICE_AUTO_SENT'::"WebhookEvent", 'RECURRING_INVOICE_CREATED'::"WebhookEvent", 'RECURRING_INVOICE_DELETED'::"WebhookEvent", 'RECURRING_INVOICE_GENERATED'::"WebhookEvent", 'RECURRING_INVOICE_ITEM_CREATED'::"WebhookEvent", 'RECURRING_INVOICE_ITEM_DELETED'::"WebhookEvent", 'RECURRING_INVOICE_ITEM_UPDATED'::"WebhookEvent", 'RECURRING_INVOICE_NEXT_DATE_CALCULATED'::"WebhookEvent", 'RECURRING_INVOICE_PROCESSED'::"WebhookEvent", 'RECURRING_INVOICE_UPDATED'::"WebhookEvent", 'SEARCH_PERFORMED'::"WebhookEvent", 'SSE_CONNECTION_ESTABLISHED'::"WebhookEvent", 'SSE_DATA_STREAMED'::"WebhookEvent", 'STATS_MONTHLY_REQUESTED'::"WebhookEvent", 'STATS_YEARLY_REQUESTED'::"WebhookEvent", 'USER_CREATED'::"WebhookEvent", 'USER_LOGGED_IN'::"WebhookEvent", 'USER_OIDC_CALLBACK'::"WebhookEvent", 'USER_OIDC_LOGIN'::"WebhookEvent", 'USER_PASSWORD_CHANGED'::"WebhookEvent", 'USER_PROFILE_UPDATED'::"WebhookEvent", 'USER_UPDATED'::"WebhookEvent", 'WEBHOOK_FAILED'::"WebhookEvent", 'WEBHOOK_TRIGGERED'::"WebhookEvent", 'XML_GENERATED'::"WebhookEvent"]::"WebhookEvent"[];

-- Etape 2 : reconstruit le type enum lui-meme sans les 79 valeurs purgees. La liste ci-dessous porte
-- TOUTES les valeurs vivantes au moment ou CETTE migration tourne en dernier — DOCUMENT_SETTLED et
-- DOCUMENT_CANCELLED incluses (voir l'en-tete : ajoutees par des migrations anterieures dans l'ordre
-- lexicographique, jamais retirees ici).
BEGIN;
CREATE TYPE "WebhookEvent_new" AS ENUM (
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
  'WEBHOOK_DELETED'
);
ALTER TABLE "Webhook" ALTER COLUMN "events" TYPE "WebhookEvent_new"[] USING ("events"::text[]::"WebhookEvent_new"[]);
ALTER TYPE "WebhookEvent" RENAME TO "WebhookEvent_old";
ALTER TYPE "WebhookEvent_new" RENAME TO "WebhookEvent";
DROP TYPE "WebhookEvent_old";
COMMIT;

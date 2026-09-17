---
sidebar_position: 3
---

# Webhook System

Outbound webhooks let external services react to events happening in Invoicerr (invoice paid, quote signed, client created, etc.).

## Dispatch mechanism

Services call `webhookDispatcher.dispatch(WebhookEvent.SOME_EVENT, payload)` (see `backend/src/modules/webhooks/webhook-dispatcher.service.ts`). The dispatcher:

1. Looks up webhooks configured for that event and the relevant company.
2. Calls the webhooks service `send()` method, which routes to the configured driver — generic HTTP, Slack, Discord, Microsoft Teams.
3. Signs the payload with HMAC-SHA256 using the webhook's secret.

## Available events

The `WebhookEvent` enum (`backend/prisma/schema.prisma`) carries exactly 18 members today, every one
of which has a real dispatch call site in `backend/src` (`backend/src/modules/webhooks/webhook-event.spec.ts`
pins the exact list; `webhook-event-emitters.spec.ts` re-derives "has a real emitter" from a live grep
on every test run, so the enum cannot silently regrow dead members). It used to carry far more: two
purges (`20260903000000_generic_document_webhook_events`, 51 members; `20260903200000_purge_dead_webhook_events`,
79 more) removed every member that had accumulated since the very first webhook module without a
real emitter ever being wired for it — per-type `QUOTE_*`/`INVOICE_*`/`PAYMENT_*`/`RECEIPT_*`/
`SIGNATURE_*`, `RECURRING_INVOICE_*`, `PLUGIN_*`, and about a dozen other families. Read either
migration's own header for the per-family evidence if you are wondering whether something that used
to exist should come back.

- **Documents** (generic across every document type — invoice, quote, credit note, purchase order,
  ...): `DOCUMENT_CREATED`, `DOCUMENT_SENT`, `DOCUMENT_SEND_FAILED`, `DOCUMENT_AUTHORITY_EVENT`,
  `DOCUMENT_DELETED`, `DOCUMENT_SETTLED`, `DOCUMENT_CANCELLED`, `DOCUMENT_SIGNED`.
- **Clients**: `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_DELETED`, `CLIENT_SEARCHED`.
- **Company**: `COMPANY_CREATED`, `COMPANY_UPDATED`, `COMPANY_EMAIL_TEMPLATE_UPDATED`.
- **Webhook subscriptions themselves**: `WEBHOOK_CREATED`, `WEBHOOK_UPDATED`, `WEBHOOK_DELETED`.

The settings screen (`frontend/.../settings/_components/webhooks.settings.tsx`) never hardcodes this
list — it renders whatever `GET /api/webhooks/options` returns, so it can never drift from the enum.

## Adding a new webhook event

1. Add the new value to the `WebhookEvent` enum in `backend/prisma/schema.prisma`.
2. Run `npx prisma migrate dev` to regenerate Prisma's types **and** create the migration — Postgres
   cannot `ALTER TYPE ... ADD VALUE` inside the same transaction some ORMs batch migrations in, but
   Prisma's own generated SQL handles a plain addition (only *removing* a value needs the
   rebuild-the-type dance either purge migration above demonstrates).
3. Call `webhookDispatcher.dispatch(WebhookEvent.YOUR_NEW_EVENT, { ...payload })` — or, for a document
   event, the `DocumentWebhookEmitter.dispatch` it mirrors (`documents/queue/document-webhooks.ts`) —
   from the relevant service, at the point where the underlying state change happens. A value with no
   real call site fails `webhook-event-emitters.spec.ts` on the next `npm test`.

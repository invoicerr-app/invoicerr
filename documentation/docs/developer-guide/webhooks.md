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

The `WebhookEvent` enum (`backend/prisma/schema.prisma`) covers ~50+ events across domains, for example:

- **Quotes**: `QUOTE_CREATED`, `QUOTE_SENT`, `QUOTE_SIGNED`, `QUOTE_EXPIRED`, `QUOTE_REJECTED`, `QUOTE_STATUS_CHANGED`, ...
- **Invoices**: `INVOICE_CREATED`, `INVOICE_SENT`, `INVOICE_PAID`, `INVOICE_OVERDUE`, `INVOICE_MARKED_AS_PAID`, `INVOICE_STATUS_CHANGED`, ...
- **Receipts**: `RECEIPT_CREATED`, `RECEIPT_CREATED_FROM_INVOICE`, `RECEIPT_SENT`, ...
- Plus events for payments, clients, company, signatures, and recurring invoices.

## Adding a new webhook event

1. Add the new value to the `WebhookEvent` enum in `backend/prisma/schema.prisma`.
2. Run `npx prisma migrate dev` to regenerate Prisma's types.
3. Call `webhookDispatcher.dispatch(WebhookEvent.YOUR_NEW_EVENT, { ...payload })` from the relevant service, at the point where the underlying state change happens.

## Inbound plugin webhooks

Separate from outbound dispatch, plugins can also receive inbound webhooks from third-party services (e.g. signature completion callbacks). See [Plugin system](./plugin-system.md#inbound-plugin-webhooks).

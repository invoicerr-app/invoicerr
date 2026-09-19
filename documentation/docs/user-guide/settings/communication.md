---
sidebar_position: 2
---

# Email & Webhooks

## Email Templates

Customise the email body sent to clients when you send quotes for signature or invoices by email. Supports placeholders for dynamic content.

:::info[Mail provider]
Email delivery itself (SMTP or Resend) is configured at the instance level via environment variables, not from this page. See [Docker Installation](../docker-installation.md#email-delivery).
:::

:::info[Language]
A template you customise here is always sent exactly as written, in whatever language you wrote it — it is not translated per recipient. See [Document Language](../document-language.md) for the automatic translation that applies to the built-in default template.
:::

## Webhooks

Configure webhook endpoints to receive real-time events (e.g. `quote.signed`, `invoice.paid`). See the [Webhooks developer guide](../../developer-guide/webhooks.md) for event types and payloads.

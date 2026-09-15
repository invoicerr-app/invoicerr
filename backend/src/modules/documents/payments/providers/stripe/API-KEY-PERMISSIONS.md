# Stripe — restricted API key for Invoicerr

This directory calls exactly one Stripe endpoint: `POST /v1/checkout/sessions`
(`stripe-checkout-client.ts`). Webhooks are verified locally by HMAC signature
(`stripe-signature.ts`, `whsec_…` secret) — no API call is needed for that.

Create the key in the Stripe dashboard → Developers → API keys → **Create restricted key**,
in test mode for `backend/.env.test.local`, in live mode for a production instance.

## Permissions

| Resource | Permission | Why |
|---|---|---|
| Checkout Sessions | **Write** | Creates the payment session for an invoice (`POST /v1/checkout/sessions`) — the only call in the code. |
| Payment Intents | Read | Re-read a payment during real-key tests and webhook diagnostics. |
| Charges and Refunds | Read | Same, to confirm the charge on Stripe's side. |
| Events | Read | Re-read a received webhook event (`checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`). |
| Everything else | **None** | Customers, Products, Prices, Subscriptions, Payment Links, Webhook Endpoints, Connect, Issuing, Terminal, Tax, Billing… are never called. |

Option: set **Charges and Refunds** to Write if refunds from Invoicerr are ever added
(not implemented today).

## Webhook

Developers → Webhooks → Add endpoint (test mode), URL
`https://<instance>/api/public/payments/stripe/<companyId>/webhook`, events:
`checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`.
Locally: `stripe listen --forward-to localhost:4000/api/public/payments/stripe/<companyId>/webhook`.

## Variables

```
STRIPE_SECRET_KEY=rk_test_…        # or sk_test_… ; rk_live_… in production
STRIPE_WEBHOOK_SECRET=whsec_…
```

Never in the repository or in a conversation: `backend/.env.test.local` (gitignored, mode 600)
for tests, encrypted company settings (`CompanyChannelConfig`) in operation.

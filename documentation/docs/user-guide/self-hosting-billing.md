---
sidebar_position: 0.8
---

# Billing on a self-hosted instance

A self-hosted Invoicerr has no subscription. Leave `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` unset,
as it is in `backend/.env.example`, and none of the billing system exists on your instance:

- no trial, no seat limit, no read-only or deletion countdown,
- no Subscription or Seats tab in Settings, no billing banner,
- no `/api/billing/*` route and no background billing job,
- no Stripe key to configure.

Every feature is available to every member of every company. Nothing else on this page is needed to run
Invoicerr for yourself or your team.

:::info[Taking online payments from your clients]
Letting your own clients pay your invoices online through Stripe, Mollie or PayPal is a different feature,
unrelated to the subscription. Each company connects its own account in Settings > Payments; no variable
is set for it on the instance.
:::

## Running a hosted offering

Billing is only meant for an operator who sells Invoicerr as a hosted service and charges its own
customers per seat through Stripe Billing. Everything below is about that case. The developer guide
page [Hosted billing](../developer-guide/hosted-billing.md) explains how it works inside.

:::info[Start in test mode]
The backend refuses a live Stripe key unless `STRIPE_MODE=live` is set. Set everything up with test
keys first, and switch only once a full subscription has gone through.
:::

### 1. Create the prices in Stripe

Create one recurring price per grid and billing period, in EUR, with **Graduated pricing** and three
tiers: up to 1 seat, up to 4 seats, then the rest. Put each yearly amount at ten times the monthly one.

- The **standard** grid is required: a monthly price and a yearly price.
- The **founder** grid is optional. If you use it, both of its prices are required.

Every price must be a different price id.

### 2. Configure the customer portal

In the Stripe dashboard, under Settings > Billing > Customer portal, enable what your customers may do
from Settings > Subscription: update the payment method (card, SEPA Direct Debit), change the seat
quantity, see their invoice history, and cancel.

### 3. Create the webhook endpoint

Point a Stripe webhook endpoint at `<APP_URL>/api/auth/stripe/webhook` and send it these events:

| Event | Why |
|---|---|
| `checkout.session.completed` | A subscription checkout finished, or a founder pre-order was paid. |
| `checkout.session.async_payment_succeeded` | A founder pre-order paid by a delayed payment method. |
| `customer.subscription.created` | Records a new subscription on the company. |
| `customer.subscription.updated` | Status, seat quantity, billing period, cancellation. |
| `customer.subscription.deleted` | The subscription ended. |
| `invoice.created` | Writes the VAT mention on each renewal invoice. |
| `invoice.paid` | Each payment becomes an invoice issued through Invoicerr. |

Copy the endpoint's signing secret: it is `STRIPE_WEBHOOK_SECRET`.

### 4. Choose how VAT is handled

`BILLING_VAT` takes one of two values:

- `franchise` (the default): no VAT is charged, and every subscription invoice carries the mention
  "TVA non applicable, art. 293 B du CGI".
- `charge`: VAT is charged through Stripe Tax, with the EU reverse charge for a business customer whose
  VAT number was validated. Set up Stripe Tax in the dashboard first (head office address, registration)
  and give each price a tax behavior. Subscriptions created under the franchise are not moved
  automatically when you switch.

### 5. Name the company that issues the invoices

Each payment is turned into an ordinary Invoicerr invoice of one company on your instance, your own,
with its numbering and its sending channel. Create that company, then set its id in
`BILLING_INVOICE_ISSUER_COMPANY_ID`. Its VAT settings must match `BILLING_VAT` (under the franchise, its
VAT exemption setting is on), and its own subscription must be active, or it cannot send. While the
variable is unset, payments are kept and wait to be issued.

### 6. Set the variables and restart

```bash
WARNING__ENABLE_BILLING_FOR_USERS__WARNING="true"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_MODE="test"
STRIPE_PRICE_STANDARD_MONTHLY="price_..."
STRIPE_PRICE_STANDARD_YEARLY="price_..."
# Optional, both or neither:
STRIPE_PRICE_FOUNDER_MONTHLY="price_..."
STRIPE_PRICE_FOUNDER_YEARLY="price_..."
BILLING_VAT="franchise"
BILLING_INVOICE_ISSUER_COMPANY_ID="..."
# Only for founder pre-orders:
BILLING_OPENING_DATE="YYYY-MM-DD"
```

The backend refuses to boot when billing is enabled and a required variable is missing or invalid, and
says which one. Each variable is described in `backend/.env.example`.

:::info[Demo mode]
`DEMO_MODE` forces billing off, whatever `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` says.
:::

### 7. Founder grid and pre-orders

The founder grid is granted per company from the backend directory:

```bash
npm run billing:grant-founder -- <companyId>
```

A founder pre-order paid before your opening date is attached to its company with:

```bash
npm run billing:claim-preorder -- <preorderId> <companyId>
```

What each command checks and refuses is described in [Hosted billing](../developer-guide/hosted-billing.md#founder-grid).

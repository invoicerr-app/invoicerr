---
sidebar_position: 7
---

# Subscription

:::info[Hosted service only]
This page applies to the hosted Invoicerr service. A self-hosted instance has no subscription, no trial
and no seat limit: the Subscription and Seats tabs do not appear in its Settings. See
[Billing on a self-hosted instance](../self-hosting-billing.md).
:::

Each company has its own subscription. If you belong to several companies, Settings > Subscription
always shows the company you are currently working in.

## Trial

A new company starts with a 14-day trial. Everything works during the trial except sending documents
(email, and deposits on e-invoicing platforms such as a PDP, Chorus Pro or KSeF). A banner at the top of
the app counts the days left.

If the company has not subscribed when the trial ends, it becomes read-only for 14 days. A full export of
its documents is then emailed to the account owner, and the company is deleted 30 days later. Subscribing
at any point before the deletion restores full access.

## Seats

You pay per seat, and every member of the company needs one, owners included. The price per seat goes
down as the company grows. On the yearly plan, excluding VAT:

| Seats | Price per seat and year |
| --- | --- |
| First seat | €120 |
| Seats 2 to 4 | €32 |
| Seat 5 onwards | €24 |

Five seats therefore cost €120 + 3 × €32 + €24 = €240 a year.

- With fewer seats than members, the members who joined most recently cannot open the company at all
  until a seat frees up or more seats are bought. They get their access back on their own, with nothing
  to do.
- With more seats than members, owners and admins see a red banner in Settings with the number of
  unused seats. Lower the quantity in the billing portal, or invite someone.

Settings > Seats shows who holds a seat and who is waiting for one.

## Subscribing

Only an owner or an admin of the company can subscribe or change the subscription. Other members see the
current plan and status, read-only.

1. Open **Settings > Subscription**.
2. Choose the **Billing period**: monthly, or yearly.
3. Choose the number of **Seats**. It starts at the number of members of the company.
4. Click **Continue to payment**. Payment happens on Stripe, by card or SEPA Direct Debit.

Back in Invoicerr, the subscription can take a minute to show as **Active**.

## Managing the subscription

**Open billing portal** takes owners and admins to Stripe, where they can:

- change the payment method (card or SEPA Direct Debit),
- change the number of seats,
- download past invoices,
- cancel the subscription.

**Cancel subscription** ends it at the end of the period already paid for. Until then, Settings >
Subscription shows the end date, and the billing portal can still keep the subscription.

## Statuses

| Status | What it means |
|---|---|
| Trial | Everything works except sending documents. |
| Active | The subscription is paid. Everything works. |
| Payment failed | The last payment did not go through. Sending is paused; update the payment method in the billing portal. The period already paid for still runs to its end. |
| Blocked | The company is read-only. Subscribe to restore full access. |
| Pending deletion | A full export was emailed to the account owner and the company will be deleted. Subscribe to cancel the deletion. |

After a paid subscription stops, the company stays readable until the end of the period already paid for,
then becomes read-only for 14 days. The export is then emailed and the company is deleted 180 days later.

## Founder pricing

Some companies hold founder pricing. It is currently the same as the public price above. Settings >
Subscription says so when your company holds it. It stays yours as long as the subscription renews without interruption: once a
subscription on founder pricing is cancelled and ends, the company moves to the standard price for good.
A failed payment that is retried, or a cancellation withdrawn before the end of the period, does not end it.

## Invoices

Every payment produces an invoice issued through Invoicerr itself, sent to the email address in the
company's settings. The billing portal also keeps the history of the payments made on Stripe.

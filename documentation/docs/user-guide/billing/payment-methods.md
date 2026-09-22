---
sidebar_position: 1
---

# Payment Methods

The **Payment Methods** page is where you turn on the ways clients can pay you. Every enabled
method prints on your invoices automatically — there is nothing to attach per document.

## How it works

Unlike Clients or Articles, this isn't a list you add entries to. Invoicerr ships a fixed set of
payment methods, each shown as its own card:

- **Bank transfer** — IBAN (required) and BIC (optional)
- **PayPal** — the receiving account's e-mail
- **Cash** — nothing to configure; the label alone is enough
- **Cheque** — the payee name a cheque should be made out to
- **Stripe** — turns on card payments through your connected Stripe account (Settings → Payments)
- **Mollie** — turns on payments through your connected Mollie account (Settings → Payments)

## Turning a method on

Flip the switch on a card. If the method needs information it doesn't have yet (an IBAN, a PayPal
e-mail…), the switch opens the configuration dialog instead of failing silently — fill it in and
save, and the method is enabled in the same step. A card already configured just toggles straight
on or off.

## Configuring a method

Click **Configure** on any card to open or change its details, whether it's currently on or off. A
method with nothing to configure (Cash, Stripe, Mollie) shows no fields at all — there's simply
nothing to fill in.

## What shows on a document

Every card's own preview — the same "field: value" lines your invoices print — appears right on
the card, so what you see here is exactly what a client sees. **Cash**, **Stripe**, and **Mollie**
show nothing beyond their own label; **Bank transfer** shows the IBAN/BIC you set; **PayPal** shows
the account e-mail.

## What this page doesn't do

- **No adding or removing methods.** The set of six is fixed; a method you don't use simply stays off.
- **No per-document choice.** A quote or invoice doesn't ask "which payment method" — every method
  you've turned on appears on every document that shows payment methods (invoices).
- **No search or filter.** There are only ever six cards.

## First use

Every method starts off. Turn on at least one — Bank transfer or PayPal need no external account,
just a field or two — before sending your first invoice.

---
sidebar_position: 2
---

# Quotes

The **Quotes** page is where you create estimates, send them to clients for signature, and turn signed quotes into invoices.

## Actions

- **Add New** — create a quote
- **Search** — find a quote by its number or client name
- **Filter** — toggle the status chips: **Draft**, **Sending**, **Sent**, **Send failed**, **Signed**, **Refused**
- **View** (eye icon) — read-only details
- **View PDF** / **Download PDF** — preview or save the quote as `quote-{number}.pdf`
- **Edit** (pencil icon) — available while the quote isn't signed
- **Send for signature** (signature icon) — email the client a secure signing link; click again to resend
- **Create invoice** (plus icon) — appears once a quote is **Signed**, turning it into an invoice
- **Request deposit** / **Generate installment invoices** — once **Sent**, raise a deposit or a milestone-split invoice directly from the quote, without waiting for it to be signed first

There is no delete action on a quote — a client can also **Decline** it from their own [Client Portal](../client-portal.md), which is instant and reversible on your side.

## Creating a quote

Click **Add New** and fill in:

- **Client** (required)
- **Date** (required) and **Due date** (optional)
- **Currency** (required)
- **Client reference / PO number** (optional) — the buyer's own reference, shown only once you fill it in
- **Line items** — each has a Designation, Quantity, Unit price, and VAT rate, plus a per-line **Discount %**; drag to reorder, or add a line straight from your [article catalog](../articles.md)
- **Notes** (optional)

There is no per-document "Payment Method" field on a quote.

## Statuses

| Status | Meaning |
| --- | --- |
| **Draft** | Created, not yet sent — editable |
| **Sending** | Send in progress |
| **Sent** | Sent to the client for signature |
| **Send failed** | The last delivery attempt failed |
| **Signed** | Approved by the client — ready to convert to an invoice |
| **Refused** | Declined by the client from their [Client Portal](../client-portal.md) |

## The flow

1. Create a quote and click **Send for signature**.
2. The client signs it online — see [Quote signing](quote-signing.md).
3. Once **Signed**, click **Create invoice** to carry everything over to an [invoice](invoices.md).

## First use

With no quotes yet, the page shows *"No quotes yet"* and an **Add New** button.

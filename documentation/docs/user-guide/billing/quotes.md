---
sidebar_position: 2
---

# Quotes

The **Quotes** page is where you create estimates, send them to clients for signature, and turn signed quotes into invoices.

## Actions

- **Add New** — create a quote
- **Search** — find a quote by its number or client name
- **Filter** — pick one or more statuses in the segmented control above the list: **Draft**, **Sending**, **Sent**, **Send failed**, **Signed**, **Refused**
- **View** (eye icon) — read-only details
- **Preview PDF** / **Download PDF** - open the quote's PDF in a new tab, or save it under the quote's number, for example `QUOTE-2026-0001.pdf` (see [PDF file name](invoices.md#pdf-file-name))
- **Edit** (pencil icon) — available while the quote isn't signed
- **Send for signature** (signature icon) — email the client a secure signing link; click again to resend
- **Create invoice** (plus icon) — appears once a quote is **Signed**, turning it into an invoice
- **Request deposit** / **Generate installment invoices** — once **Sent**, raise a deposit or a milestone-split invoice directly from the quote, without waiting for it to be signed first

- **Delete** - available only on a **Draft** quote, after a confirmation; see [Deleting a draft](#deleting-a-draft)

A client can also **Decline** a sent quote from their own [Client Portal](../client-portal.md), which is instant and reversible on your side.

## Deleting a draft

Choose **Delete** in a draft quote's row menu or on its own page, then confirm: the draft is removed
permanently. The delete is refused while an invoice created from that draft still exists (delete the
invoice first), or while a recurrence uses it as its template.

:::info[Why a sent quote cannot be deleted]
Sending a quote gives it a number, and a numbered quote is never deleted, even if you edit it back
into a draft afterwards: **Delete** is not offered, and the server refuses it even when asked directly
through the API. A client can still decline it, and you can simply leave it unsigned.
:::

## Creating a quote

Click **Add New**. As for an invoice, every field is on one page with a live preview of the quote beside it ([details](invoices.md#creating-an-invoice)). Fill in:

- **Client** (required): pick an existing client, or use **Create new client** to add one on the spot
  with just a name and a country; see [Clients](../clients.md#creating-a-client-from-a-quote-or-an-invoice)
- **Date** (required) and **Due date** (optional). If you set quote [payment terms](../settings/payment-terms.md), the due date is filled in as soon as you pick the date; you can still change it
- **Currency** (required)
- **Client reference / PO number** (optional) — the buyer's own reference, shown only once you fill it in
- **Line items**: the same fields as an invoice line, Designation, Quantity, [Unit](invoices.md#creating-an-invoice), Unit price, VAT rate (optional on a quote), a per-line **Discount %** and a work date; drag to reorder, or add a line straight from your [article catalog](../articles.md). The quote PDF shows the Unit column like the invoice PDF
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

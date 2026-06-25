---
sidebar_position: 6
---

# Invoices

The **Invoices** page is where you bill your clients. You can create invoices from scratch or convert a signed [quote](quotes.md).

## Actions

- **Add New** — create a one-time or recurring invoice
- **Search** — find an invoice by number, title, or client name
- **Filter** — toggle the **Sent**, **Unpaid**, **Overdue**, **Paid**, and **Upcoming** badges
- **View** (eye icon) — read-only details
- **Download** — choose **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL**, or **CII**
- **Send by email** — email the invoice as a PDF attachment
- **Mark as paid** — record payment manually
- **Edit** (pencil icon) — available for unpaid invoices
- **Create receipt** (receipt icon) — generate a [receipt](receipts.md) from this invoice
- **Delete** (trash icon) — available for unpaid invoices

## Creating an invoice

Click **Add New** and fill in:

- **Client** (required) and optional **Title**
- **Currency** and **Payment Method** (optional)
- **Type** — one-time or recurring (with frequency and end date)
- **Line items** — Name, an optional multi-line Description (supports `**bold**` and `*italic*`), Type, Quantity, Unit Price, and VAT Rate; drag to reorder, or add a line straight from your [article catalog](articles.md)
- **Discount Rate** (0–100%) and **Notes** (optional)

### Creating from a quote

Once a quote is **Signed**, click **Create invoice** on the quote. All client info, line items, and details carry over. You can adjust before finalising.

## Statuses

| Status | Meaning |
| --- | --- |
| **Sent** | Created and sent to the client |
| **Unpaid** | Awaiting payment |
| **Overdue** | Past the due date |
| **Paid** | Payment received |
| **Upcoming** | Recurring invoice scheduled for the next period |

## Download formats

| Format | Use case |
| --- | --- |
| **PDF** | Standard printable invoice |
| **Factur-X** | French e-invoicing standard (PDF + XML) |
| **ZUGFeRD** | German e-invoicing standard (PDF + XML) |
| **XRechnung** | German public-sector e-invoicing |
| **UBL** | Universal Business Language XML |
| **CII** | Cross-Industry Invoice XML |

## First use

With no invoices yet, the page shows *"No invoices yet"* and an **Add New** button. If you have a signed quote, use **Create invoice** from the [Quotes](quotes.md) page to skip data entry.

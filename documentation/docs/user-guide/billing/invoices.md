---
sidebar_position: 4
---

# Invoices

The **Invoices** page is where you bill your clients. You can create invoices from scratch or convert a signed [quote](quotes.md).

## Actions

- **Add New** — create an invoice
- **Search** — find an invoice by its number or client name
- **Filter** — toggle the status chips: **Draft**, **Sending**, **Sent**, **Send failed**, **Cancelled**
- **View** (eye icon) — read-only details
- **Download** — a plain **PDF** is always available; once the invoice has been numbered, **Download normalized XML** adds **CII**, **UBL**, **Factur-X**, **FA(3)** (Polish KSeF), **FatturaPA** (Italian SdI), **Peppol BIS Billing 3.0**, and **XRechnung**
- **Send** — deliver the invoice through email or, once connected, a country's e-invoicing channel (KSeF, SdI, PDP…)
- **Mark as paid** — record payment manually, or use [Bank Reconciliation](bank-reconciliation.md)
  to confirm one from an imported bank statement
- **Edit** — available only while the invoice is still a **Draft**; once sent, a mistake is fixed with a correction, not a re-edit
- **Cancel** — voids an already-sent invoice, where this country's law allows it; this replaces "delete" — an invoice that reached "Sent" is never removed, only cancelled
- **Issue credit note** - start a [credit note](credit-notes.md) correcting this invoice's own lines
- **Create receipt** (receipt icon) — generate a [receipt](receipts.md) from this invoice

## Creating an invoice

Click **Add New** and fill in:

- **Client** (required)
- **Date** and **Due date** (both required)
- **Currency** (required)
- **Origin document** and **Corrects invoice** (optional) — links back to the quote/invoice this one was raised from, or the invoice it corrects
- **Client reference / PO number** (optional) — the buyer's own reference, shown only once you fill it in
- **Line items** — Designation, Quantity, Unit, Unit price, VAT rate, and a per-line **Discount %**; drag to reorder, or add a line straight from your [article catalog](../articles.md)
- **Notes** (optional)

There is no per-document "Payment Method" field: every enabled [payment method](../billing/payment-methods.md) your company has turned on is printed on the invoice automatically, and the one actually used is only recorded afterwards, when you mark the invoice as paid.

### Creating from a quote

Once a quote is **Signed**, click **Create invoice** on the quote. All client info, line items, and details carry over. You can adjust before finalising.

### Recurring invoices

There is no "recurring" choice at creation time. Once an invoice exists, its row menu offers a
**duplicate/recurrence** action that schedules a fresh copy on a cadence you set (with an optional
"then send" step) — see the row's own action menu on an existing invoice.

## Statuses

| Status | Meaning |
| --- | --- |
| **Draft** | Created, not yet sent — editable |
| **Sending** | Send in progress |
| **Sent** | Delivered to the client — this is also when **Paid** / **Partially paid** starts being tracked as a balance, shown alongside the status rather than replacing it |
| **Send failed** | The last delivery attempt failed |
| **Cancelled** | Voided; no longer legally in force |

## Download formats

| Format | Use case |
| --- | --- |
| **PDF** | Standard printable invoice |
| **CII** | UN/CEFACT Cross Industry Invoice XML |
| **UBL** | Universal Business Language 2.1 XML |
| **Factur-X** | French e-invoicing standard (PDF/A-3 with embedded CII) |
| **FA(3)** | Polish KSeF national schema |
| **FatturaPA** | Italian SdI national schema |
| **Peppol BIS Billing 3.0** | Pan-European Peppol network format |
| **XRechnung** | German public-sector e-invoicing (KoSIT) |

## VAT in your own country's currency

If your company is established in France, Poland or Italy and you invoice a client in a foreign currency, the law requires the VAT amount (and, in Italy, the taxable amount too) to also be stated in your own country's currency. When this applies, the invoice's PDF and detail page print that converted figure next to the invoice's own currency, together with the exchange rate and its date.

The rate is looked up once, at the moment the invoice is numbered, and frozen from then on: it never changes on a later read, even if your exchange rate table is updated afterwards. France and Italy use the daily European Central Bank rate; Poland uses the National Bank of Poland's Table A rate for the business day before the invoice, as its own law requires. If no rate exists yet for the currency you're invoicing in (for example a currency Poland's own source doesn't publish), sending is refused rather than guessing: pick a different currency or wait for the source to publish one.

This only applies to invoices for now: a credit note correcting such an invoice does not yet carry the conversion. See the [country compliance matrix](../../developer-guide/country-support/index.md) and the per-country pages under [Countries](../../developer-guide/countries/index.md) for the exact sourced rule behind each country.

## First use

With no invoices yet, the page shows *"No invoices yet"* and an **Add New** button. If you have a signed quote, use **Create invoice** from the [Quotes](quotes.md) page to skip data entry.

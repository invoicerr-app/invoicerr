---
sidebar_position: 4
---

# Invoices

The **Invoices** page is where you bill your clients. You can create invoices from scratch or convert a signed [quote](quotes.md).

## Actions

- **Add New** — create an invoice
- **Import** / **Import CSV**: record a past invoice from a previous tool; see
  [Migrating from another tool](migrating-from-another-tool.md)
- **Search** — find an invoice by its number or client name
- **Filter**: toggle the status chips: **Draft**, **Sending**, **Sent**, **Send failed**, **Cancelled**, **Imported**
- **View** (eye icon) — read-only details
- **Download** - a plain **PDF** is always available; once the invoice has been numbered, **Download normalized XML** adds **CII**, **UBL**, **Factur-X**, **FA(3)** (Polish KSeF), **FatturaPA** (Italian SdI), **Peppol BIS Billing 3.0**, and **XRechnung**. An **Imported** invoice also offers **Download original** - see [Migrating from another tool](migrating-from-another-tool.md#downloading-the-original)
- **Send** — deliver the invoice through email or, once connected, a country's e-invoicing channel (KSeF, SdI, PDP…)
- **Mark as paid** — record payment manually, or use [Bank Reconciliation](bank-reconciliation.md)
  to confirm one from an imported bank statement
- **Edit** — available only while the invoice is still a **Draft**; once sent, a mistake is fixed with a correction, not a re-edit
- **Correct** (scale icon, appears once an invoice is **Sent** or **Send failed**): opens the correction routes for this invoice; see below. This is also where **cancelling** an invoice lives: an invoice that reached "Sent" is never removed, only cancelled, and only where this country's law allows it
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

There is no per-document "Payment Method" field: every enabled [payment method](../billing/payment-methods.md) your company has turned on is printed on the invoice automatically - unless the client has its own [restriction](../clients.md#restricting-payment-methods-for-a-client), in which case only the methods you allowed for that client are printed. The one actually used is only recorded afterwards, when you mark the invoice as paid.

### Creating from a quote

Once a quote is **Signed**, click **Create invoice** on the quote. All client info, line items, and details carry over. You can adjust before finalising.

### Recurring invoices

There is no "recurring" choice at creation time. Once an invoice exists, its row menu offers a
**duplicate/recurrence** action that schedules a fresh copy on a cadence you set (with an optional
"then send" step) — see the row's own action menu on an existing invoice.

## Correcting an invoice

Click the scale icon on a **Sent** or **Send failed** invoice to see the correction routes your seller country's law allows for it. Only routes you can actually consider are listed. Each route carries a short, plain-language explanation of what it means for you and, where the law provides one, a short legal reference (for example "Art. 106j ust. 1, VAT Act"), never the raw legal research notes behind the app's own country data.

- **Required** or **Allowed** routes are choosable. Picking one that this app implements (an internal credit note, a local cancellation, or, for Poland, a corrective invoice) takes you straight to the pre-linked screen; picking one your country's law permits but this app doesn't implement yet shows an honest "not implemented" message instead of pretending to run something.
- **Not established** routes are shown but not choosable: the law hasn't settled whether this country allows them.
- Routes your country's law forbids outright are never shown. If every route for this country is forbidden, the dialog says so in one sentence instead of leaving an empty list.

Choosing a local cancellation asks you to confirm first: it is irreversible, and the invoice's number is never reused.

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

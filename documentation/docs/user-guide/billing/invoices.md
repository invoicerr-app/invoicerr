---
sidebar_position: 4
---

# Invoices

The **Invoices** page is where you bill your clients. You can create invoices from scratch or convert a signed [quote](quotes.md).

Each row shows the invoice's total **including VAT**, labelled "incl. VAT" under the figure,
before any payment or credit note. What is still owed on it is in its settlement panel.

## Actions

- **Add New** — create an invoice
- **Import** / **Import CSV**: record a past invoice from a previous tool; see
  [Migrating from another tool](migrating-from-another-tool.md)
- **Search** — find an invoice by its number or client name
- **Filter**: toggle the status chips: **Draft**, **Validated**, **Sending**, **Sent**, **Send failed**, **Cancelled**, **Imported**
- **View** (eye icon) — read-only details
- **Download** - a plain **PDF** is always available; once the invoice has been numbered, **Download normalized XML** adds **CII**, **UBL**, **Factur-X**, **FA(3)** (Polish KSeF), **FatturaPA** (Italian SdI), **Peppol BIS Billing 3.0**, and **XRechnung**. An **Imported** invoice also offers **Download original** - see [Migrating from another tool](migrating-from-another-tool.md#downloading-the-original)
- **Validate** - assign the invoice's legal number and lock it, without sending anything. A warning
  appears first: this is final, correct a mistake with a credit note afterwards, the same as for a sent
  invoice. For a French domestic invoice to a business client, or any Italian domestic invoice,
  validating also transmits it through your accredited channel (PDP for France, SdI for Italy). A
  French invoice to a private client needs no PDP and is only numbered and locked. Each country's own law treats the invoice
  as not genuinely issued until it reaches that channel - the warning dialog says so explicitly in
  that case, naming the channel and stating it cannot be undone; see
  [France](../../developer-guide/countries/france.md#validate-and-the-pdp-mandate) and
  [Italy](../../developer-guide/countries/italy.md#validate-and-the-sdi-mandate). For every other
  invoice, **Send** stays a separate, later step. Validating is refused while the client has no
  address or no city, and while your company or the client lacks an identifier your country's law
  requires on this invoice (see
  [Identifiers on the PDF](#identifiers-on-the-pdf)); the message names what is missing
  and links to the client
- **Send**: deliver the invoice through email or, once connected, a country's e-invoicing channel (KSeF, SdI, PDP…). Available both before and after validating; sending an already-validated invoice never re-assigns its number, it only delivers it
- **Mark as paid** — record payment manually, or use [Bank Reconciliation](bank-reconciliation.md)
  to confirm one from an imported bank statement
- **Edit** — available only while the invoice is still a **Draft**; once sent, a mistake is fixed with a correction, not a re-edit
- **Delete** - available only on a **Draft**, after a confirmation; see [Deleting a draft](#deleting-a-draft)
- **Correct** (scale icon, appears once an invoice is **Validated**, **Sent** or **Send failed**): opens the correction routes for this invoice; see below. This is also where **cancelling** an invoice lives: an invoice that reached "Sent" is never removed, only cancelled, and only where this country's law allows it
- **Issue credit note** - start a [credit note](credit-notes.md) correcting this invoice's own lines
- **Create receipt** (receipt icon) — generate a [receipt](receipts.md) from this invoice

## Creating an invoice

Click **Add New** and fill in:

- **Client** (required): pick an existing client, or use **Create new client** to add one on the spot
  with just a name and a country. The client must be complete before the invoice is validated or sent;
  see [Clients](../clients.md#completing-a-client-before-invoicing)
- **Date** and **Due date** (both required). The due date is filled in as soon as you pick the date, from your [payment terms](../settings/payment-terms.md); you can still change it
- **Currency** (required)
- **Origin document** and **Corrects invoice** (optional) — links back to the quote/invoice this one was raised from, or the invoice it corrects
- **Client reference / PO number** (optional) — the buyer's own reference, shown only once you fill it in
- **Line items** — Designation, Quantity, Unit, Unit price, VAT rate, and a per-line **Discount %**; drag to reorder, or add a line straight from your [article catalog](../articles.md)
- **Notes** (optional)

The **Unit** field is a list you can also type into. Clicking it, or reaching it with the keyboard,
opens the common units (piece, unit, hour, day, week, month, year, kilogram, gram, litre, metre,
kilometre, set, box) in your language; typing narrows the list, the arrow keys and Enter pick an
entry, and any other text you type is kept as it is. Unit is optional.

A unit picked from the list is stored as its UN/ECE Recommendation 20 code (for example `HUR` for
hour or `H87` for piece): the e-invoice XML carries that code, and the PDF prints the unit's name in
the document's language. A unit typed by hand is printed as typed and exported as the generic code
`C62` ("one"), so the XML stays valid. Units typed in English before the list existed (`hour`,
`day`, `kg`, `m` and similar) keep the code they were always exported with, so the XML of an
invoice already issued does not change.

Quotes, invoices, credit notes and received invoices all offer the same line fields, Unit included.

:::info[Units typed before the list existed]
On upgrade, units typed as free text on draft quotes, invoices and credit notes are converted to
their code when the text names exactly one unit (`h` becomes hour). Anything ambiguous, such as `m`
(metre or minute), stays as typed. A quote that was sent, signed or accepted, and an issued invoice
or credit note, are never modified.
:::

When you type a **Designation**, matching items from your [article catalog](../articles.md) are
offered under the field. A small spinner shows at the right of the field while the search is
running, and the list says so when nothing in the catalog matches.

There is no per-document "Payment Method" field: every enabled [payment method](../billing/payment-methods.md) your company has turned on is printed on the invoice automatically - unless the client has its own [restriction](../clients.md#restricting-payment-methods-for-a-client), in which case only the methods you allowed for that client are printed. The one actually used is only recorded afterwards, when you mark the invoice as paid.

### Creating from a quote

Once a quote is **Signed**, click **Create invoice** on the quote. The client, currency, notes and
every line field (unit, discount, work date and the rest) carry over. The invoice is dated today and
its due date is filled from your [payment terms](../settings/payment-terms.md), never from the
quote's validity date. You can adjust everything before finalising.

**Duplicate** on an invoice makes a new draft dated today, with its due date recalculated the same
way.

### Recurring invoices

There is no "recurring" choice at creation time. Once an invoice exists, its row menu offers a
**duplicate/recurrence** action that schedules a fresh copy on a cadence you set (with an optional
"then send" step) — see the row's own action menu on an existing invoice.

## Deleting a draft

A draft invoice has no number yet, so you can delete it: choose **Delete** in the row's menu or on the
invoice's own page, then confirm. The draft is removed permanently.

The delete is refused, with a message saying why, while something still depends on the draft:

- a credit note names it as the invoice it corrects: delete that credit note first;
- a recurrence uses it as its template: delete the recurrence first;
- another invoice names it as its origin: delete that invoice first.

Time entries that were billed into the draft become unbilled again, ready for another invoice.

:::info[Why a numbered invoice cannot be deleted]
Validating or sending an invoice gives it a number from your continuous sequence, and an issued number
must never disappear from it. From then on **Delete** is no longer offered, and the server refuses it
even when asked directly through the API. Correct the invoice with a [credit note](credit-notes.md)
or, where your country allows it, cancel it; see [Correcting an invoice](#correcting-an-invoice).
:::

## Correcting an invoice

Click the scale icon on a **Validated**, **Sent** or **Send failed** invoice to see the correction routes your seller country's law allows for it. Only routes you can actually consider are listed. Each route carries a short, plain-language explanation of what it means for you and, where the law provides one, a short legal reference (for example "Art. 106j ust. 1, VAT Act"), never the raw legal research notes behind the app's own country data.

- **Required** or **Allowed** routes are choosable. Picking one that this app implements (an internal credit note, a local cancellation, or, for Poland, a corrective invoice) takes you straight to the pre-linked screen (for a credit note, with all of the invoice's lines already checked); picking one your country's law permits but this app doesn't implement yet shows an honest "not implemented" message instead of pretending to run something.
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

## Identifiers on the PDF

The PDF prints, under each party's address, every identifier filled in on your company and on the
client (SIREN, VAT number, NIF, Partita IVA, ...), each under the name its own country gives it.

Some of them are mandatory on an invoice, depending on your country's law and on the sale. For
example, in France: your SIREN always, your VAT number unless you use the small-business VAT
exemption, the SIREN of a French business client (never of a private client, who has none), and both
VAT numbers when you invoice a business in another EU country. While the invoice is a draft, its PDF
marks each mandatory identifier that is still empty as missing, in red and in the language of the
PDF. The PDF the client receives never shows that marker.

**Validate** and **Send** refuse an invoice while one of those mandatory identifiers is empty. The
message names each one, under its country's name and with whose it is (your company or the client),
and offers a button to the place to fill it in: **Edit company** when your company lacks one, **Edit
client** otherwise. A draft can always be saved.

:::info[Where the list comes from]
The rules for each country are sourced to its invoicing law and listed on its
[country support page](../../developer-guide/country-support/index.md), under "Required identifiers".
The app reads a client of type **Company** as a business and a client of type **Individual** as a
private person: it does not know whether a client is registered for VAT.
:::

## VAT in your own country's currency

If your company is established in France, Poland or Italy and you invoice a client in a foreign currency, the law requires the VAT amount (and, in Italy, the taxable amount too) to also be stated in your own country's currency. When this applies, the invoice's PDF and detail page print that converted figure next to the invoice's own currency, together with the exchange rate and its date.

The rate is looked up once, at the moment the invoice is numbered, and frozen from then on: it never changes on a later read, even if your exchange rate table is updated afterwards. France and Italy use the daily European Central Bank rate; Poland uses the National Bank of Poland's Table A rate for the business day before the invoice, as its own law requires. If no rate exists yet for the currency you're invoicing in (for example a currency Poland's own source doesn't publish), sending is refused rather than guessing: pick a different currency or wait for the source to publish one.

This only applies to invoices for now: a credit note correcting such an invoice does not yet carry the conversion. See the [country compliance matrix](../../developer-guide/country-support/index.md) and the per-country pages under [Countries](../../developer-guide/countries/index.md) for the exact sourced rule behind each country.

## First use

With no invoices yet, the page shows *"No invoices yet"* and an **Add New** button. If you have a signed quote, use **Create invoice** from the [Quotes](quotes.md) page to skip data entry.

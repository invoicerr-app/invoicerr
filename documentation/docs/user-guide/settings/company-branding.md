---
sidebar_position: 1
---

# Company settings

## Company

Your business identity — this information appears on every document you issue.

- **Name** (required)
- **VAT Number** (optional)
- **Legal ID / SIRET** (optional) — the identifiers offered here depend on your country; see
  [Country support](../../developer-guide/country-support/index.md)
- **Address** — Street, Address Line 2, Postal Code, City, State / Province, Country
- **Email** and **Phone**
- **Currency** — default currency for new documents
- **Date Format**
- **Default document language** — the language a document (PDF and email) renders in for any client
  who hasn't set one of their own; see [Document Language](../document-language.md)

Picking a country fills in **Currency** with that country's usual currency. Change it if you invoice
in another one; opening the settings again never changes it on its own.

Your country matters more than it looks: it decides which identifiers you are asked for, which VAT
rates you can pick, how an invoice may be corrected, and whether the law forces a particular delivery
channel. The [country compliance matrix](../../developer-guide/country-support/index.md) shows what is
established for each supported country, and says plainly where nothing has been established.

### Invoice PDF format

- A dropdown offers **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL**, or **CII** as your
  default e-invoicing format. The choice is saved, but nothing in the app reads it back yet: every
  invoice still renders as an ordinary PDF unless you pick a different format yourself from that
  invoice's own **Download** menu (see [Invoices](../billing/invoices.md#download-formats)).

### Document numbering

Document number formats are not a setting. They are fixed per country and per document type, from the
rules that constrain them: the tax law (a unique, sequential number), the e-invoicing formats (for
example FatturaPA's 20-character limit in Italy) and the clearance platforms (for example Chorus Pro's
20 characters for French public buyers). The **Number Formats** card of the company settings shows, for
each numbered document type, the format that applies, the next number it will print, and every rule
behind it with its source. Nothing on that card can be edited, and the API refuses a change.

| Country | Invoice | Credit note | Quote, purchase order, goods receipt |
| --- | --- | --- | --- |
| France, Germany, Italy, Poland | `INVOICE-{year}-{number:4}` | `CN-{year}-{number:4}` | `QUOTE-…`, `PURCHASE-ORDER-…`, `GOODS-RECEIPT-…` (`-{year}-{number:4}`) |
| Portugal | `FT A/{number}` | `NC A/{number}` | as above |

**The counter restarts at 1 on 1 January, only where a primary source actually permits it.** France,
Germany and Italy read a text that allows a calendar-year series for the invoice (Germany and France
for the credit note too); Poland and Portugal, and every quote/purchase-order/goods-receipt format in
every country, stay on one counter that never restarts: `{year}` there only prints the moment of
issuance. The Number Formats card shows which applies to each type, and the source behind it. The
restart itself applies only from the first document dated **1 January 2027** or later: a series already
running keeps its counter exactly where it stood, and a document dated in December but numbered in
January still belongs to the old year's series.

**A series you started before formats became fixed** is kept, because an issued series has to stay
continuous. The card marks it "Your running series, kept". The one exception is a series whose format
breaks a rule of your country (the old credit-note format `CREDIT-NOTE-{year}-{number:4}` is 21
characters, too long for FatturaPA and Chorus Pro): the country format then applies from the next
number, the counter going on where it stood, so no number is reused and none is skipped. The card says
so on that document type.

**A kept series never restarts unless its own printed number carries a year.** The yearly restart above
applies to the *country's* format; a kept series that never printed a year of its own (for example
`FAC-{number}`) keeps counting up, year after year, even in a country and document type where the
country's own format restarts every January: printing the same year-less number again would be a
duplicate invoice number, which is unlawful everywhere this product ships. A kept series that does print
its own year (for example `FACT-{year}-{number:5}`) restarts exactly like the country format does. The
card always shows the reset rule of the series actually in use, whichever it is, next to its pattern.

Portuguese sellers register, in the ATCUD section of the settings screen, the AT validation code of each
series before its first document: the AT issues one per series and document type, so series `FT A` for
invoices and series `NC A` for credit notes. The ATCUD section shows which series the next document
belongs to.

**Migrating from another tool?** A **Declare your last number issued** card, right below the Number
Formats card, lets you tell Invoicerr where your previous tool's own numbering left off, so your next
invoice or credit note continues from there instead of restarting at 1, usable on its own or together
with [importing your past invoices](../billing/migrating-from-another-tool.md). It can only be used
once per document type, before that type's first Invoicerr document.

### Multi-currency

The **Multi-currency** card's **Reference currency** field turns on one consolidated dashboard total, in the currency you pick, alongside your existing per-currency figures. Leave it empty to keep every total grouped by currency, unchanged.

The **Exchange rates** card right below it lists the rates that consolidation, and payment currency conversion, use:

- **Add it yourself**: enter a rate for any currency pair. Correcting one means adding a new rate dated later, since the most recently dated rate for a pair always wins; there is no edit or delete.
- **Refreshed automatically once a day**: a background job refreshes every pair you have already added, plus every pair your documents, clients and recorded payments actually use against your reference currency and against each other, from the European Central Bank first and, only for a currency the ECB does not quote, from exchangerate-api.com as a fallback (credited on the card when used). A currency neither source quotes stays unconverted until you add it by hand.
- **Gaps**: a pair neither source has ever been able to refresh is listed separately on the card, so you know its rate is still only whatever you last typed by hand.

The same rates also convert a payment you record in a currency different from its invoice's own; recording it is refused if no rate exists for that pair on the day the payment arrived.

### Revenue basis

A **Revenue basis** card decides which figure your dashboard and statistics count as revenue, and
over which period:

- **Revenue basis** - **Invoiced** (counts revenue the moment a document is issued, this product's
  own long-standing behaviour) or **Cashed** (counts it only once a payment actually arrives). Left
  unset, it defaults per your company's country where a clear regime exists: France and Italy
  default to **Cashed** (both have a sourced micro-entrepreneur/regime forfettario basis), every
  other supported country defaults to **Invoiced**. The card states the sourced reason behind
  whichever default applies to you.
- **Declaration period** - **Monthly** or **Quarterly**, used to bucket the **Cashed revenue**
  settings tab (below). Defaults to monthly.

Both are an aid, not tax advice. Verify against your own accounting records before declaring.

A period that has already closed keeps the consolidated total it showed when it closed: entering a
new exchange rate today never revises a past period's own figure on the dashboard, even in a
company that invoices in several currencies.

### Cashed revenue

The **Cashed revenue** settings tab lists, period by period, what was actually received against
sent invoices, as opposed to what was invoiced, converted into your reference currency at each
payment's own rate, dated to when that payment arrived. Each period shows the rate, its date and
its source, and a period where nothing was cashed still shows as zero rather than being left out.
Export the whole thing as a CSV for your own records; the view and the export both say plainly that
this is an aid, never your official declaration.

## What this page used to describe, and does not any more

This page previously documented a **Logo** upload, a **Website** field, an **Exempt VAT** toggle, a
per-type **Number Format / Starting Number** block, and a whole **PDF Templates** section (typography,
colours, spacing, label overrides, live preview).

Those descriptions did not match the application, so they have been removed rather than left in place:
the fields either do not exist, are not stored, or are not read by anything that produces a document.
When a capability genuinely lands, it is documented here again — this page describes what the
product does, never what it is expected to do.

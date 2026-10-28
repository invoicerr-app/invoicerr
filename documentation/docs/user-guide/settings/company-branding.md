---
sidebar_position: 1
---

# Company settings

## Company

Your business identity — this information appears on every document you issue.

- **Name** (required)
- **VAT Number** and **Legal ID**: the identifiers offered here, and the ones you must fill in to
  save, depend on your country (a SIRET in France, a Partita IVA in Italy, a NIP in Poland, a NIF in
  Portugal); see [Country support](../../developer-guide/country-support/index.md)
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

### Company-law details

When your country's company law asks for more than identifiers, a **Company-law details** group
appears under them. Pick your **legal form** first: the fields that follow are the ones that form must
show on your documents, for example in France the share capital and the city of the RCS registry for
an SAS or an SARL, in Germany the register court and the managing directors of a GmbH, in Italy the
companies register office, registration number and paid-up capital of an S.r.l. A field marked
required is one the law asks of your form; the others are printed only when you fill them in.

A sole trader, or any form with no share capital, is never asked for one, and no capital line is
printed. The group does not appear at all for a country that has nothing declared. What you enter is
printed under your company name on the PDF, in the document's language (see
[Company-law mentions on the PDF](../billing/invoices.md#company-law-mentions-on-the-pdf)). Changing
country keeps what you entered, so switching back loses nothing.

:::info[Amounts]
Type the share capital as a plain amount, with a dot or a comma for decimals, and pick its currency.
It is printed like every other amount of the PDF, for example `1000.00 EUR`.
:::

### Company profile

Some rules of your country depend on facts about your company that only you can declare. When your
country asks for any, the company settings show a **Company profile** card with one choice per
question. A country that asks nothing shows no card.

France asks one question today, the **Company size category**: large enterprise, intermediate-sized
enterprise (ETI), small or medium-sized enterprise (PME) or micro-enterprise, the categories of the
loi de modernisation de l'économie (art. 51), assessed on 1 January 2025 from your last closed
financial year. It decides from when your invoices to French business clients must go through an
accredited platform (PDP):

| Size category | Accredited platform required for invoices issued from |
| --- | --- |
| Large enterprise, ETI | 1 September 2026 |
| PME, micro-enterprise | 1 September 2027 |
| Not declared | 1 September 2026 |

:::warning[Not declared means the earliest date]
Until you declare a category, Invoicerr applies the earliest date. A PME or micro-enterprise without
a connected platform cannot validate an invoice to a French business client until it declares its
category.
:::

"Micro-enterprise" is the statistical category, not the micro-entrepreneur tax regime, although most
micro-entrepreneurs belong to it. A company that is a member of a VAT group (assujetti unique) follows
the large-company calendar whatever its size: do not declare PME or micro-enterprise for it.

Receiving invoices through a platform is required of every company from 1 September 2026, whatever
its size.

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

## Branding

The **Branding** settings tab personalizes every PDF your company issues (quotes, invoices, credit
notes and the other document types) with four things:

- **Logo** (PNG, JPEG or WebP, 10 MB at most), printed at the top left of the first page.
- **Accent color**, used for the rule under the header and for the small section labels.
- **Font**: Inter, Source Serif 4, IBM Plex Sans, DM Sans or Lora, or the default system font.
- **Document template**: **Classic** (the default) or **Atelier**. Atelier sets the document title
  large in a serif face, puts the dates and references in a band tinted with your accent color,
  shows the totals in a tinted box and frames the payment details. It changes the presentation
  only: every word, identifier, legal mention and the Factur-X data are the same as with Classic.
  Your logo, accent color and font apply to both.

Four **Presets** (Classic, Modern, Minimal, Bold) set an accent color and a font in one click. The
**Preview** renders a sample invoice with your current settings, through the same renderer as a real
document.

## PDF layout

The order of the content is the same for every company and every template, and cannot be edited: it has to carry the legal
mentions and identifiers each country requires, and one fixed layout is what keeps that reliable. A
document reads, from top to bottom:

1. **Header**: your logo on the left; the document type, its number and its date on the right (with
   the Atelier template, the logo sits above the large document title instead).
2. **Parties**: your company, its company-law mentions and its address on the left, the client (or the supplier, on a purchase
   order or a received invoice) and its address on the right, each followed by the identifiers filled
   in for it (see [Identifiers on the PDF](../billing/invoices.md#identifiers-on-the-pdf)).
3. **Details**: the short fields of the document (issue date, due date, currency, client reference,
   and so on) in one compact grid. An optional field left empty, such as the origin document of an
   invoice, is not printed.
4. **Lines**: the line table (on a credit note linked to an invoice, the corrected lines). On a
   document longer than a page, its header row is repeated at the top of every page and a line is
   never cut in two.
5. **Totals**: right under the last line, on the same page as it.
6. **Notes**, then the payment block (SEPA QR code and payment methods side by side), the legal
   mentions, and your custom fields.

:::info[Page breaks]
The layout is designed so that a short document (a few lines, ordinary notes, the usual legal
mentions and payment details) fits on one A4 page; long notes, many custom fields or a long list of
mentions can still push the end of the document onto a second page. When the lines run over a page,
the break falls between two lines, and the totals move with at least the last line rather than
starting a page on their own. Only the totals and lines are kept together: notes, payment details
and mentions flow onto the next page as needed.
:::

## What this page used to describe, and does not any more

This page previously documented a **Website** field, an **Exempt VAT** toggle, a per-type **Number
Format / Starting Number** block, and a whole **PDF Templates** section (colours, spacing, label
overrides). The logo, accent color, font and preview now live in **Branding**, described above.

Those descriptions did not match the application, so they have been removed rather than left in place:
the fields either do not exist, are not stored, or are not read by anything that produces a document.
When a capability genuinely lands, it is documented here again — this page describes what the
product does, never what it is expected to do.

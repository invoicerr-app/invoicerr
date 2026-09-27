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

The counter of a series never restarts, including at the start of a year: `{year}` only prints the
year the number was issued in.

**A series you started before formats became fixed** is kept, because an issued series has to stay
continuous. The card marks it "Your running series, kept". The one exception is a series whose format
breaks a rule of your country (the old credit-note format `CREDIT-NOTE-{year}-{number:4}` is 21
characters, too long for FatturaPA and Chorus Pro): the country format then applies from the next
number, the counter going on where it stood, so no number is reused and none is skipped. The card says
so on that document type.

Portuguese sellers register, in the ATCUD section of the settings screen, the AT validation code of each
series before its first document: the AT issues one per series and document type, so series `FT A` for
invoices and series `NC A` for credit notes. The ATCUD section shows which series the next document
belongs to.

## What this page used to describe, and does not any more

This page previously documented a **Logo** upload, a **Website** field, an **Exempt VAT** toggle, a
per-type **Number Format / Starting Number** block, and a whole **PDF Templates** section (typography,
colours, spacing, label overrides, live preview).

Those descriptions did not match the application, so they have been removed rather than left in place:
the fields either do not exist, are not stored, or are not read by anything that produces a document.
When a capability genuinely lands, it is documented here again — this page describes what the
product does, never what it is expected to do.

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

The pattern used to number a document type is set per type, and the app falls back to a sensible
default for any type you have not configured. Portuguese sellers should read the ATCUD section of the
settings screen, where the invoice series is part of the numbering pattern.

## What this page used to describe, and does not any more

This page previously documented a **Logo** upload, a **Website** field, an **Exempt VAT** toggle, a
per-type **Number Format / Starting Number** block, and a whole **PDF Templates** section (typography,
colours, spacing, label overrides, live preview).

Those descriptions did not match the application, so they have been removed rather than left in place:
the fields either do not exist, are not stored, or are not read by anything that produces a document.
When a capability genuinely lands, it is documented here again — this page describes what the
product does, never what it is expected to do.

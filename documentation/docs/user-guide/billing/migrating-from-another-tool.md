---
sidebar_position: 4.6
---

# Migrating from another tool

If you are moving from a previous invoicing tool, Invoicerr lets you bring your billing history with
you and keep your numbering continuous, without pretending those past invoices were ever issued by
Invoicerr itself.

## Two separate things

- **Declaring your last number issued**: tells Invoicerr where your numbering left off, so the next
  invoice or credit note you issue in Invoicerr continues from there, with no gap. This works even if
  you never import a single past document.
- **Importing a past document**: records an invoice or credit note your previous tool already issued,
  with its own original number and date, so your history, statistics and client balances are complete.

You can do either on its own, or both.

## Declaring your last number issued

In **Settings → Company**, the **Declare your last number issued** card lets you tell Invoicerr the
last number your previous tool printed, and the date it was issued:

1. Choose the **Document type** (Invoice or Credit note).
2. Type the **Last number issued**, exactly as your previous tool printed it (for example
   `FA-2026-0142`), and the **Date it was issued**.
3. Click **Infer from example**. Invoicerr suggests a **Pattern** (for example `FA-{year}-{number:4}`).
   Check it, or type your own; it must reproduce the last number exactly once confirmed.
4. Click **Declare**.

What happens next depends on your country's own rules (see [Document numbering](../settings/company-branding.md#document-numbering)):

- If your pattern satisfies your country's own rules, it becomes your running series: your next
  document keeps the SAME format your previous tool used, continuing at last + 1.
- If it does not (for example, it is too long for your country's e-invoicing format), your country's
  own fixed format applies instead, but the counter still continues at last + 1, never restarting at 1
  and never skipping a number.
- **Portugal is different, see below.**

This can only be declared **once per document type**, and only **before** you issue your first
Invoicerr document of that type. Once a document has been numbered, the declaration is refused: your
numbering has already started, and nothing may silently move it.

## Importing a past document

From the **Invoices** or **Credit notes** page, two entry points sit next to **Add New**:

- **Import**: for one document at a time. Upload the original file (PDF, or the XML your previous
  tool produced), then fill in the usual fields (client, date, lines…) plus the document's **original
  number** and, if you have it, **transmission evidence** (see below).
- **Import CSV**: for many at once. Upload every original file first, then a CSV listing one row per
  document, each naming the file it goes with by filename. A preview shows which rows will be
  imported and which are rejected, with the reason, before anything is written. A CSV row carries at
  most one line item and a credit note imported this way is always a free one (not linked to a
  specific invoice); a document with several lines, or a credit note linked to a specific invoice's
  lines, needs the one-at-a-time **Import** form instead.

An imported document gets its own status, **Imported**:

- Its **original number and date are kept exactly as you entered them**, never reformatted, never
  checked against your current numbering pattern.
- **It never consumes your numbering counter.** Importing a hundred past invoices does not move your
  running series by a single number.
- **It can never be sent, e-invoiced, edited, or renumbered.** These are not merely hidden: Invoicerr's
  document lifecycle has no path out of "Imported" at all, so even a direct API call is refused.
- **It still counts everywhere it should**: in your statistics (under its own real, historical date,
  so importing history does not inflate this month's figures unless the import genuinely is dated this
  month), in a client's balance, and as a candidate for bank reconciliation.
- **You can still record a payment against it, send reminders on it, and issue a credit note against
  it.** A credit note against an imported invoice is priced from the invoice's own lines, exactly like
  against any other invoice, provided the import carried lines (the per-document form always does;
  a CSV row does too, if you filled in its line columns). Without lines, only a free credit note citing
  it is possible.
- **It is excluded from the accounting export by default**: your previous tool's own export already
  has it; re-exporting it from Invoicerr would count it twice.

### The original file is your legal archive

The file you attach (PDF or XML) is kept as the legal archive of the imported document, exactly like
a document Invoicerr issued and delivered itself: kept for the legal retention period your country
requires, and never deletable. That retention period is counted from the document's own **original
issue date**, never from the day you imported it: importing a five-year-old invoice today does not
reset its five-year clock.

### Downloading the original

An imported document's actions menu offers two separate downloads:

- **Download PDF** renders the document only when the original you attached was itself a PDF. When it
  was not (the XML your previous tool produced), this action refuses and points you to **Download
  original** instead.
- **Download original** serves the exact file you attached at import time, byte for byte, with its own
  file name and content type, whatever format it was issued in (PDF, XML, or an image). This is the
  only way to retrieve a non-PDF original, and it only ever appears on an imported document.

:::info[Your data export and the client portal]
The account data export (Settings → the "take your data away" zip) includes each imported document's
original file the same way, alongside its JSON record. Imported documents are never shown in the
client portal: it only ever lists what Invoicerr itself sent to a client, and an imported document was
never sent by Invoicerr.
:::

### Transmission evidence, and the warning when you have none

Some countries require an invoice to be transmitted through a specific channel to be legally issued at
all: Italy's SdI, Poland's KSeF, France's accredited platforms, Portugal's ATCUD. When you know your
previous tool's own reference (an SdI id, a KSeF number, an accredited-platform reference, or an
ATCUD), enter it: it is kept as a record, and for Poland it also lets a later credit note (a faktura
korygująca) correctly cite the original invoice's KSeF number.

If you leave every transmission field empty, the import is still accepted, but the document's detail
page shows a visible, lasting warning that it must be regularised with the relevant authority. This
warning does not go away on its own: in a country like Italy, an invoice that never actually reached
the SdI is "not issued" in law, whatever record of it Invoicerr keeps, and only the relevant authority
can fix that.

### Portugal: a new series, always

Portuguese law never allows reusing a validation code or restarting a series that has been used before,
not one of your own past series, and not one your previous tool used either. Because of this,
declaring your last number issued in Portugal **never** resumes your previous tool's own series: it
always opens a new one, under Invoicerr's own series identifier "A" (`FT A/{number}` for invoices,
`NC A/{number}` for credit notes), unless your previous tool already used identifier "A" itself, in
which case Invoicerr dates the new one instead (`FT A2026/{number}`, for a declaration made in 2026),
so it can never collide with what your previous tool already registered.

Either way, your counter still continues at last + 1: only the series **identifier** is new, never
the numbering itself. Register the identifier the result names with the tax authority (in **Settings →
ATCUD**) before your first Invoicerr document of that type.

## What v1 does not cover yet

Importing directly from the official original your previous tool produced (a FatturaPA XML with its
SdI receipt, a KSeF number lookup, a Factur-X/XRechnung file, a Portuguese SAF-T export) is a later
step. Today, you attach the original file and type in the rest by hand (or a CSV row).

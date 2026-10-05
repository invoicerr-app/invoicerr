---
sidebar_position: 4
---

# Articles

The **Articles** page is a catalog of reusable line items — services or products you bill often — that you can drop straight into a quote or invoice instead of retyping them every time.

## Actions

- **Add New** — create a catalog article
- **Search** — find an article by name
- **Edit** (pencil icon) — update an article's details
- **Delete** (trash icon) — remove an article from the catalog

## Creating an article

Click **Add New** and fill in:

- **Name** (required) — shown in the catalog picker
- **Description** (optional, multi-line) — supports `**bold**` and `*italic*`; copied onto the line item as its description
- **Type** — Hour, Day, Deposit, Service, or Product
- **Unit Price** and **VAT Rate**
- **Quantity** and **Low stock threshold** (both optional) - see **Stock tracking** below

## Stock tracking

Leave **Quantity** blank and an article is not stock-tracked at all: nothing about it is ever
counted, and picking it on a line never changes anything else. Set a **Quantity** and the article
starts tracking stock from that number; **Low stock threshold** then controls when it shows up as
low stock on the Articles page (leave it blank for no alert at all).

:::info[Which documents move stock]
Only **sending an invoice** decrements stock, by the quantity on every line that references a
tracked article. Sending a quote, sending a credit note, and sending a purchase order never change
stock, even when their own lines reference the same article: a quote is not a commitment to
deliver, and a credit note corrects an invoice without moving goods a second time. Converting an
accepted quote into an invoice and sending that invoice decrements stock exactly once, at the
invoice's own send - never at the quote's.
:::

## Using an article in a line

Each line has a **Designation** field. Start typing in it and the catalog articles whose name matches are listed under the field. Pick one with the mouse, or with the Up and Down arrow keys followed by Enter, and the line is filled with the article's Name, Unit Price and VAT Rate. Escape closes the list. Quantity and every other field stay yours to adjust, and the catalog article itself is left untouched.

You never have to pick anything: if you ignore the list, whatever you typed is kept as a free-text line.

The **From catalog** button on each line opens the same catalog as a picker, for browsing instead of typing. It applies the same values.

### Received invoices

The lines of a received invoice get the same help: typing in **Designation** or using **From catalog** copies the article's Name, Unit Price and VAT Rate into the line. The line is not linked to the article, so recording a received invoice never changes the article's stock.

## First use

With no articles yet, the page shows *"No articles yet"* and an **Add New** button. Articles are entirely optional — you can always type line items by hand on a quote or invoice.

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

## Using an article in a quote or invoice

While editing line items on a quote or invoice, use the **Add from catalog...** picker next to **Add Item** and select an article. It adds a new line pre-filled with the article's Name, Description, Type, Unit Price, and VAT Rate — adjust the quantity or any field before saving, the catalog article itself is left untouched.

## First use

With no articles yet, the page shows *"No articles yet"* and an **Add New** button. Articles are entirely optional — you can always type line items by hand on a quote or invoice.

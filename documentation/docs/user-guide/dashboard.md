---
sidebar_position: 2
---

# Dashboard

The **Dashboard** is the first page you see after signing in. It greets you by name and opens on an
overview of your invoicing, in your company currency:

- **Invoiced this month**, before VAT, with how much more or less that is than last month.
- A curve of the money **collected** each month this year, continued as a dashed line with what your
  clients **still owe by due month** for the months ahead. The curve is hidden on a phone.
- **To chase**: the clients with at least one invoice past its due date, one row per client, with how
  many days late the oldest one is and what is still owed. **See the late invoices** opens the list
  of exactly those invoices.
- **This week**: the invoices falling due in the next seven days, today included.

Amounts in another currency are never added to the curve or the monthly figure; the two lists show
each invoice in its own currency.

Below the overview, **All figures** holds one panel of figures answering the questions about your
business: what you invoiced, what came in, what clients still owe, and what is waiting for you, then
the lists and the chart of invoices issued. A late figure is marked with a triangle next to its label.

## Choosing a period

The **Period** selector at the top decides what the tiles cover: **All time** (the default), **This
month**, **This year**, **Last 30 days** or a **Custom range** with a start and an end date. The line
next to it says which dates are shown. The period is part of the page address, so a bookmark or a
shared link opens the same view.

With **All time**, the invoicing, collection and expense tiles show **this month**, compared with
last month. With any other period they show the total **in that period**, with no comparison.

## The tiles

- **Invoiced this month** (or **Invoiced in period**): what you invoiced, by issue date.
- **Collected this month** (or **Collected in period**): the payments you actually received, by
  payment date. An invoice issued months ago counts here in the month its payment arrived.
- **Pending invoices total**: what your clients still owe on the invoices you sent.
- **Overdue invoices total**: the part of that whose due date has passed.
- **Expenses this month** (or **Expenses in period**).
- **Open quotes**: how many quotes are still a draft or are sent and waiting for an answer.
- **Received invoices pending review**: how many supplier invoices are waiting for you, and
  **Received invoices pending** for their amount.
- **Pending invoices**: the invoices still owed, the earliest due date first.
- **Draft quotes**: your five most recent draft quotes.
- **Invoices issued**: a chart of how many invoices you issued per month, over the last six months,
  or over each month of the selected period.

Amounts are shown per currency, one tile for each: amounts in different currencies are never added
up. A currency gets a "this month" tile only when something happened in it this month. Last month's
figure is then the comparison under the tile, for example **+12%**. A currency used last month but
not this month gets no tile at all, never a "0" next to a "-100%". When nothing at all happened this
month, a single tile shows 0.

## Which amount each figure shows

- **Pending invoices total** and **Overdue invoices total** show what your clients still owe,
  **including VAT**: each invoice's total minus the payments and credit notes recorded against it,
  the same balance its settlement panel shows.
- Each row of **Pending invoices** shows the invoice's total including VAT, the figure its row in
  the invoice list shows.
- **Invoiced this month** (or **Invoiced in period**) shows your revenue **excluding VAT**.
- **Collected this month** (or **Collected in period**) is the cash actually received, as recorded
  in each payment.

The invoice tiles and the pending list say "incl. VAT" or "excl. VAT" under their title.

## Opening the list behind a tile

A tile with an arrow in its corner opens the list of exactly the documents it counts, filtered on
the same period. The **Collected** tiles have no arrow: there is no list of payments to open.

## Several currencies

Set a **Reference currency** in the **Multi-currency** card of your
[company settings](settings/company-branding.md#multi-currency) and the dashboard adds one converted
total next to the per-currency tiles, for pending invoices, collected payments, expenses and received
invoices. A converted total starts with "≈" and says "(converted)". If a rate is missing for one of
the currencies, the per-currency tiles say so instead of showing a converted total. A period that has
already closed keeps the converted total it showed when it closed.

## No data yet

On a new company every tile shows 0 and the lists say **Nothing to show.** They fill in as you send
invoices, record payments and add expenses. See [Overview](overview.md) for the recommended
getting-started order.

---
sidebar_position: 4
---

# Payment terms

**Settings > Invoicing > Payment terms** sets the due date a new quote or invoice starts with, so you
do not have to pick it on every document. Quotes and invoices each have their own setting.

- **Number of days** - how many days after the issue date the document falls due. Leave it empty to
  keep the due date blank, as it was before you set anything.
- **Counted** - **Net, from the issue date** adds the days to the issue date. **End of month, from
  the issue date** adds the days, then moves to the last day of the month it lands in. An invoice
  issued on 15 October with 30 days, end of month, is due on 30 November.

## How it applies

As soon as you pick the issue date on a new quote or invoice, the due date is filled in. Changing the
issue date recalculates it, until you edit the due date yourself: from then on your own value is
kept. A document that already exists is never changed by this setting, and neither is a document
created from another one, such as an invoice raised from a quote.

Recurring invoices keep their own date logic and ignore this setting.

## Legal maximum

Where your country's law caps the payment term between businesses, the screen shows a warning when
the days you enter exceed it. The warning never blocks the save: it tells you the term may not be
enforceable, nothing more. A country with no known cap shows no warning. See
[France](../../developer-guide/countries/france.md#payment-term-cap) for the cap that is configured
today.

---
sidebar_position: 6.5
---

# Declarations

Some countries require you to tell the tax authority about your invoices or payments yourself,
whatever way the invoice reached your client. Invoicerr files these declarations for you when your
country requires one and the matching channel is connected.

## When Invoicerr files a declaration

| What you do | What gets declared |
| --- | --- |
| **Validate** an invoice (numbered and locked, not sent) | Declarations due on issue, such as Portugal's communication to the AT |
| **Send** an invoice | Declarations due on issue, if not already filed, and declarations due on sending, such as France's e-reporting of sales to private clients |
| **Record a payment** | Declarations due on payment, such as France's payment data |

An invoice you validate and send later is declared once, not twice.

If Invoicerr cannot tell whether a declaration is due (for example the client has no type, or your
company has not declared its size category), it does not guess: the declaration shows as blocked
with the reason, and you can complete the missing information.

## Following your declarations

The **Declarations** page (route `/declarations`) lists every declaration attempt, most recent
first, with the authority's answer. A declaration that could not be filed (missing credentials, an
authority error after every retry) shows there as blocked or failed, so nothing fails silently.

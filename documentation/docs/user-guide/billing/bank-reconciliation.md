---
sidebar_position: 6
---

# Bank Reconciliation

**Bank reconciliation** matches the lines of a bank statement you import against your unpaid
invoices, and records a payment once you confirm a match. It never records a payment on its own —
the machine only ever proposes, you confirm.

## Importing a statement

1. Open **Bank reconciliation** from the sidebar and click **Import statement**.
2. Drag in, or browse to, a **CSV** or **OFX**/QFX file.
3. For a CSV file, tell Invoicerr **"Which column is which?"**: the Date column, the Amount column,
   the Label column, an optional Reference column, the date format, and the decimal separator. There
   is no saved bank profile — you map columns the same way on every import, since a French bank's
   export and a German one's share no common layout.
4. Click **Import**.

OFX files are read directly — both the older SGML-style and the modern XML-style exports — covering
the transaction data every real statement export contains, though not the full OFX specification.

## Reviewing suggestions

A statement line that brings money **in** may show a suggested invoice when its amount matches an
unpaid invoice's outstanding balance **exactly**, and either the invoice's number appears in the
line's own label or reference (flagged **Invoice number found**), or the line's date falls in a
plausible window around the invoice's issue or due date. A line that matches only on amount, with
neither signal, is never suggested — it's left for you to find by hand instead of guessed at.

Lines that take money **out** are shown for reference but are never reconcilable.

## Confirming a match

Click **Reconcile** against the invoice you want — a suggested one, or one you pick yourself when
nothing was suggested. This is the only action in this feature that writes anything: it records a
real payment on that invoice, the same kind the invoice's own **Mark as paid** action creates, and
the invoice's balance and status update accordingly.

## What stays unmatched

A line with no confirmed match simply stays pending — there is no "ignore" or dismiss action, and
nothing is ever deleted. A bank fee, an owner's own transfer, or a client's deposit against work with
no invoice yet are all realistic reasons a line is never reconciled, not errors to clear away.

## What it won't do

- **Invoices only.** It matches against invoices, never credit notes, quotes, or any other document.
- **No partial or fuzzy matching.** The amount must match the outstanding balance exactly for a
  suggestion to appear. A genuine part-payment can still be recorded, but only by picking it
  yourself — the matching engine never guesses at one.
- **No currency conversion.** A statement declares one currency for every line in it, and a
  suggestion only ever appears when that currency matches the invoice's own. A foreign-currency
  payment can still be reconciled by hand; it's just never suggested.
- **No duplicate-import check.** Importing the same statement file twice creates two statements —
  take care not to re-upload one you've already reconciled.
- **No live bank feed.** Statements are files you download from your bank and upload here; there is
  no automatic sync with your bank.
- **Reconciling is final.** There is no button in this feature to undo a confirmed match.

## First use

Have at least one sent, unpaid invoice, then import your bank's statement export to see it
suggested.

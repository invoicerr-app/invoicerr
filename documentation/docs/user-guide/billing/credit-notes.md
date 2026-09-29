---
sidebar_position: 4.5
---

# Credit notes

The **Credit notes** page is where you correct an invoice you already sent, or issue a standalone refund. A credit note is legally an invoice in its own right: once issued it is delivered to the client and archived the same way an invoice is, and it can no longer be edited.

## Two kinds of credit note

- **Linked** - corrects a specific invoice. Set **Invoice**, then pick the **Corrected lines**: the rows on that invoice this credit note credits. Amount, currency and the rendered PDF all come from the invoice's own selected rows, priced with the invoice's own per-line discount, so you never re-type figures.
- **Free** - no invoice to correct (an overpayment refund, a commercial gesture). Leave **Invoice** empty and fill in your own **Lines** instead, plus a **Reason** explaining the deduction.

A linked credit note's **Currency** always matches the invoice it corrects and isn't editable independently. A free credit note has no client of its own (the type carries no client field), so it is archived but not delivered to anyone; deliver it yourself if the client needs a copy.

## Actions

- **Add New** - start a free credit note
- **Issue credit note** - from an invoice's own action menu, starts a linked credit note pre-filled with that invoice
- **Search** - find a credit note by its number or client name
- **Filter** - toggle the status chips: **Draft**, **Sending**, **Sent**, **Send failed**
- **View** (eye icon) - read-only details
- **Download** - PDF, and once numbered, the same normalized XML formats as an [invoice](invoices.md#download-formats)
- **Send** - issue the credit note: it is delivered on the invoice's own channel (email or e-invoicing) and archived. There is no separate "edit after issued" action; a mistake here is fixed with a further credit note

## Delivery

A linked credit note is delivered exactly the way the invoice it corrects would be delivered to the same client: by email with its own PDF attached, or through the connected e-invoicing channel (PDP, SdI, Chorus Pro, and so on), evaluated against the **credit note's own issue date** rather than the invoice's. On an e-invoicing channel it is built in that channel's own credit-note form (for example Factur-X 381, FatturaPA TD04) and names the invoice it corrects.

Some channels cannot carry a credit note at all. KSeF and Invopop are two examples today, since Poland's tax law gives a seller-issued reduction no instrument of its own (see [Poland](/compliance/pl)). Sending is refused before a number is spent, naming the channel, rather than issuing a credit note nobody can deliver.

## Archiving

Once sent, a credit note gets its own **Legal archive** card, exactly like a sent invoice: the exact PDF the client received (or, on a structured channel, the file actually deposited), kept for as long as your country's retention rule requires. See [Backups](../backups.md) for how archives are stored and restored. A credit note issued before this existed keeps none; its download still renders fresh, since it was never delivered through this mechanism.

## When a credit note is refused

Before any number is spent, a credit note is refused rather than issued half-way when:

| Situation | What you see |
| --- | --- |
| The invoice's channel has no lawful way to carry a credit note (for example a French domestic credit note by email after the e-invoicing mandate date) | Refused, naming the channel and the reason |
| The invoice you're correcting has no number of its own | Refused: nothing to correct yet |
| Your country gives sellers no credit-note instrument at all (Poland) | Refused: use a corrective invoice instead |
| A linked credit note has no corrected lines selected, or a free one has no lines | Refused: nothing to credit |

## Statuses

| Status | Meaning |
| --- | --- |
| **Draft** | Created, not yet sent. Editable |
| **Sending** | Send in progress |
| **Sent** | Delivered (or, for a free credit note, archived). Also when it is settled against the invoice's own balance |
| **Send failed** | The last delivery attempt failed |

## First use

With no credit notes yet, the page shows *"No credit notes yet"* and an **Add New** button. To correct an existing invoice, use **Issue credit note** from that invoice instead of starting here.

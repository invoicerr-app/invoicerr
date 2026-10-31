---
sidebar_position: 4.5
---

# Credit notes

The **Credit notes** page is where you correct an invoice you already sent. A credit note is legally an invoice in its own right: once issued it is delivered to the client and archived the same way an invoice is, and it can no longer be edited.

## Two kinds of credit note

- **Linked** - corrects a specific invoice. Set **Invoice**, then pick the **Corrected lines**: the rows on that invoice this credit note credits. Amount, currency and the rendered PDF all come from the invoice's own selected rows, priced with the invoice's own per-line discount, so you never re-type figures. Every line of the invoice is checked as soon as the invoice is set, whether you start from the invoice's **Issue credit note** button or pick the invoice in a new credit note; picking another invoice checks all of its lines instead. Uncheck the ones you do not want to credit for a partial credit note.
- **Free** - no invoice to correct (an overpayment refund, a commercial gesture). Leave **Invoice** empty, choose the **Client** it is for, and fill in your own **Lines** instead, plus a **Reason** explaining the deduction. These lines have the same fields as an invoice line, Unit included. A free credit note is sent to its own client, through that client's transport, exactly like a linked one. It can still be saved as a draft before the client is chosen, but **Send** refuses it until then.

A linked credit note's **Currency** always matches the invoice it corrects and isn't editable independently. Its **Client** is filled from that invoice and locked to it, so a linked credit note can never name a different recipient.

:::info[Free credit notes are not legal everywhere]
Some countries give sellers no credit-note instrument of their own, only a corrective invoice (Poland, for example). In those countries **Save draft** and **Send** refuse a free credit note and name the rule, rather than letting you issue a document that has no legal basis there.
:::

## Actions

- **Add New** - start a credit note; set **Invoice** to the invoice it corrects, or leave it empty and choose a **Client** for a free one, before sending it
- **Issue credit note** - from an invoice's own action menu, starts a linked credit note pre-filled with that invoice, including against an imported one (see below)
- **Import** / **Import CSV** - record a past credit note from a previous tool; see
  [Migrating from another tool](migrating-from-another-tool.md). A CSV-imported credit note is always free (no invoice link); a linked import needs the one-at-a-time form
- **Search** - find a credit note by its number or client name
- **Filter** - toggle the status chips: **Draft**, **Sending**, **Sent**, **Send failed**, **Imported**
- **View** (eye icon) - read-only details
- **Preview PDF** / **Download PDF** - open the credit note's PDF in a new tab, or save it under the credit note's number (see [PDF file name](invoices.md#pdf-file-name))
- **Download normalized XML** - once numbered, the same normalized XML formats as an [invoice](invoices.md#download-formats). An **Imported** credit note also offers **Download original** - see [Migrating from another tool](migrating-from-another-tool.md#downloading-the-original)
- **Send** - issue the credit note: a linked one is delivered on the invoice's own channel, a free one on its own client's channel (email or e-invoicing), then archived. There is no separate "edit after issued" action; a mistake here is fixed with a further credit note
- **Delete** - available only on a **Draft**, after a confirmation; see [Deleting a draft](#deleting-a-draft)

## Deleting a draft

A draft credit note has no number yet. Choose **Delete** in its row menu or on its own page, then
confirm: the draft is removed permanently, and the invoice it pointed to is left untouched. Deleting the
credit note is also how you free a draft invoice that it was correcting, so that invoice can be
deleted in turn.

:::info[Why an issued credit note cannot be deleted]
Sending a credit note gives it a number from your continuous sequence. From then on it can no longer be
deleted, through the screen or the API; a mistake is corrected by a new document, never by removing
this one.
:::

## Delivery

A linked credit note is delivered exactly the way the invoice it corrects would be delivered to the same client: by email with its own PDF attached, or through the connected e-invoicing channel (PDP, SdI, Chorus Pro, and so on), evaluated against the **credit note's own issue date** rather than the invoice's. On an e-invoicing channel it is built in that channel's own credit-note form (for example Factur-X 381, FatturaPA TD04) and names the invoice it corrects.

A free credit note is delivered the same way to the **Client** it names, on that client's own transport, with its own **Lines**. It references no preceding invoice, so its electronic form carries no invoice reference.

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
| A linked credit note has no corrected lines selected | Refused: nothing to credit |
| A free credit note (no **Invoice**) with no **Client** | Refused: there is nobody to send it to |

## Statuses

| Status | Meaning |
| --- | --- |
| **Draft** | Created, not yet sent. Editable |
| **Sending** | Send in progress |
| **Sent** | Delivered and archived. Also when it is settled against the invoice's own balance |
| **Send failed** | The last delivery attempt failed |

:::info[Free credit notes sent by an earlier version]
Before free credit notes were refused at **Send**, sending one marked it **Sent** although it was delivered to nobody. If you self-host and sent free credit notes on an earlier version, download each one's PDF and send it to the client yourself.
:::

## First use

With no credit notes yet, the page shows *"No credit notes yet"* and an **Add New** button. To correct an existing invoice, use **Issue credit note** from that invoice instead of starting here.

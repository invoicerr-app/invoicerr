---
sidebar_position: 3.5
---

# Client Portal

The **Client Portal** gives one of your clients their own read-only window into their account with
you — every document you've sent them and their balance, in one place, with no fresh email chain
needed every time. Access is by invite only; there is no self-service sign-up.

## Inviting a client

1. On the **Clients** page, find the client and click **Client portal access** on their row.
2. In the dialog, click **Create a new invite**.
3. If the client has a contact email on file, Invoicerr emails them the link automatically. If not,
   the dialog shows the raw link for you to copy and send yourself — the invite is created either
   way.
4. The client opens the link and lands in their portal. No account or password to create.

## What the client sees

- **Your balance** — every invoice you've sent them (and any credit note against one), with an
  outstanding total, and a **Download PDF** button on each document.
- **Your quotes** — every quote you've sent them, its status, and an **Accept** / **Decline**
  button while it's awaiting a decision.

Only documents in a client-facing status appear — a draft is never shown, and neither is a
cancelled invoice. A client only ever sees their own company's documents; there is no view, however
constructed, that reaches another client's account.

## Accepting or declining a quote

Clicking **Accept** does not sign the quote on the spot. It sends the client the same secure
signing email used for the ordinary Quote Signing flow — they still have to open that link and enter
the OTP code sent to their address before the quote counts as signed. The portal is only the
trigger; the signature guarantee is unchanged.

Clicking **Decline** takes effect immediately, with no email and no code — it is a reversible
preference, not a binding refusal document.

## Managing invites

A client can have more than one active invite at a time (for example, if you generate a fresh link
without revoking the old one). The dialog lists every active invite with its creation and expiry
date, and you can:

- **Revoke** — deactivate one invite.
- **Revoke all access** — deactivate every invite for that client at once.

Revoking takes effect immediately: the very next request made with that link fails, permanently.

## Security

- **The link is the credential.** Anyone who has it can open the portal — there is no separate
  password. Treat it the way you would a password, and send it only to the client it's for.
- **It expires after 30 days.** After that, or after you revoke it, the client must ask you for a
  fresh invite — there is no self-service renewal.
- **One client, one account.** A link minted for a client can only ever show that client's own
  documents and balance; it cannot be used to reach any other client's data, in your company or any
  other.

## What the portal doesn't do

- **No payments.** The portal shows the balance; it does not collect a payment.
- **No profile editing.** A client can't change their own contact details or documents from here.
- **No messaging.** There is no chat or comment thread — only documents and quote decisions.
- **No self-service renewal.** An expired or revoked link cannot be reactivated by the client; you
  have to issue a new invite.

## First use

Once you have at least one client with a document you've sent them, open that client's row on the
Clients page and click **Client portal access** to send your first invite.

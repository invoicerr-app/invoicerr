---
sidebar_position: 5
---

# Quote Signing

The **Quote Signing** page is the client-facing side of the quote process. When you send a quote for signature, your client receives an email with a secure link to `/signature/[id]` — no account required.

## The signing flow

1. You click **Send for signature** on a [quote](quotes.md).
2. Invoicerr emails the client with a unique signing link.
3. The client opens the link and sees a clean, read-only view of the quote.
4. To sign, the client enters the **8-digit OTP** that was sent to their email.
5. After successful OTP verification, the client clicks **Sign** to approve the quote.
6. Both you and the client can **Download PDF** of the signed quote.

## Client experience

The signing page shows:

- Quote number, date, and valid-until date
- Company details and client details
- Full line-item table (description, quantity, unit price, VAT, total)
- Total before tax, total VAT, and grand total
- **Sign** button (locked until the correct OTP is entered)

## Statuses

After signing, the quote status changes to **Signed** on your side, and the **Create invoice** action becomes available in [Quotes](quotes.md).

## Resending

If the client didn't receive the email, click **Send for signature** again on the quote to resend the link and a new OTP.

## First use

The first time you send a quote for signature, make sure your client's email address is correct on their [client profile](clients.md).

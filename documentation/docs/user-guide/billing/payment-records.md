---
sidebar_position: 4.7
---

# Payment records and the publisher attestation

Every payment you record on an invoice is permanent. It can never be edited or deleted, by you,
by an administrator or by deleting the invoice. This is what French law asks of software that
records payments from consumers, and Invoicerr applies it to every company.

## Correcting a payment

A wrong payment is cancelled by a **reversal**: a second payment of the opposite amount that
points at the first one, with the reason you give. Both stay on record, and the invoice's balance
goes back to what it was before the wrong payment. Then record the right payment, if there is one.

- A payment can be reversed only once.
- A reversal cannot itself be reversed. If you reversed the wrong payment, record it again.
- The reversal keeps the original currency and exchange rate.

Reversals go through the API today: `POST /api/payment-ledger/payments/{id}/reverse` with a
`reason`, and optionally `paidAt`, the date the money went back.

## How the records are protected

- Each payment gets a sequence number and a fingerprint that includes the fingerprint of the
  payment before it. Changing or removing any payment breaks every fingerprint after it.
- Each fingerprint is signed with your instance's secret.
- Every elapsed day, month and year is closed with its total and the running total since the first
  payment, per currency. Closures are chained the same way.
- `GET /api/payment-ledger/verify` checks the whole chain and lists every record that does not
  match. `GET /api/payment-ledger/closures` lists the closures, optionally filtered with
  `?kind=DAILY`, `MONTHLY` or `YEARLY`.

Days, months and years are counted in UTC.

## Archives

`POST /api/payment-ledger/archives?year=2025` downloads a JSON file with the year's payments and
closures, the result of a chain check, and a notice explaining each field in the company's
country language. The `X-Content-SHA256` response header carries the file's fingerprint.

Invoicerr keeps a copy of every archive it generates. `GET /api/payment-ledger/archives` lists
them, and `GET /api/payment-ledger/archives/{id}` downloads one again, unchanged. Keep your own
copy too: the archives are deleted with the company.

## Publisher attestation (France)

For a company established in France, `GET /api/payment-ledger/attestation` downloads the
individual publisher attestation, filled in from the administration's model with the software
name and version and your company's name. Print it, check it and keep it: the tax administration
can ask for it.

The publisher's own details come from the instance's settings. When one is missing, the line is
left blank and the `X-Attestation-Missing` header names it. On a self-hosted instance, set them
yourself:

| Variable | Line of the attestation |
| --- | --- |
| `CASH_RECORDING_PUBLISHER_NAME` | Publisher's company name |
| `CASH_RECORDING_PUBLISHER_REPRESENTATIVE` | Name and role of the person who signs |
| `CASH_RECORDING_PUBLISHER_CITY` | City where it is signed |
| `CASH_RECORDING_MARKETED_SINCE` | Date the software was first marketed |

:::info[Who must have one]
The obligation applies to a VAT-registered business that records payments from consumers in
software. It does not apply to a business that only sells to professionals, to a business under
the VAT franchise or the agricultural flat-rate scheme or making only exempt supplies, or to a
foreign business not established in France. Invoicerr does not hold NF525 certification.
:::

## Resetting company data

**Reset Company Data** is refused while the company has recorded payments, because their
invoices can no longer be deleted. Deleting the whole company is still possible.

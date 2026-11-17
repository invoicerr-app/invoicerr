---
sidebar_position: 6.8
---

# Payment ledger

Code: `backend/src/modules/documents/payment-ledger/`. Payment rows are written by
`documents/settlement/payments.ts`.

## Append-only in the database

The migration `20261117090000_payment_ledger` adds a `BEFORE UPDATE OR DELETE` trigger,
`payment_ledger_guard`, on `DocumentPayment`, `PaymentLedgerClosure` and `PaymentLedgerArchive`.
It raises `PAYMENT_LEDGER_APPEND_ONLY` except in two cases:

- a `DELETE` whose company row is already gone, which is the cascade of a company deletion;
- the one `UPDATE` that seals a payment: `hash` goes from null to a value and nothing but the four
  seal columns changes.

`DocumentPayment.document` is `onDelete: NoAction`, so deleting a document that has payments fails
on the foreign key. The check runs at the end of the statement, so a company deletion, which
removes documents and payments together, still passes. `TRUNCATE` does not fire row triggers, so
the instance reset still empties these tables.

Tests and fixtures cannot delete payments either. Clean up by deleting the company.

## The payment chain

`recordPayment` runs in one transaction:

1. `pg_advisory_xact_lock` on `payment-ledger:<companyId>` serialises writers of one company.
2. The row is inserted with `createdAt` from `clock_timestamp()`, read under the lock, so
   `createdAt` order and sequence order agree.
3. `sealPendingPayments` takes every unsealed row in `(createdAt, id)` order and sets
   `ledgerSequence` (gapless from 1), `previousHash`, `hash` and `signature`.

`hash` is the sha256 of a canonical JSON array (`canonicalPayment` in `ledger-hash.ts`): a format
version, the company, the sequence, every business field of the payment, `createdAt`,
`reversesPaymentId` and `previousHash`. Changing what goes in requires a new
`PAYMENT_LEDGER_HASH_VERSION` and verifying old rows with the old layout.

`signature` is an HMAC-SHA256 of the hash with a key derived from `BETTER_AUTH_SECRET`
(`JWT_SECRET` as fallback) and a fixed label. Rotating the secret makes every earlier signature
fail verification; the hashes still check.

## Reversals

`reverse.ts` records a new payment with negated `amountMinor` and `documentAmountMinor`, the
original's currency, conversion and method, and `reversesPaymentId`. `reversesPaymentId` is
unique, so a concurrent second reversal fails with a 409. A reversal cannot be reversed. The
settlement is a sum of payments, so no document status changes; a `DOCUMENT_SETTLED` webhook
already sent is not retracted.

## Closures

`closeElapsedPeriods(companyId)` takes the same lock, seals pending rows, then for `DAILY`,
`MONTHLY` and `YEARLY` closes every elapsed UTC period with at least one payment that has no
closure yet. Each closure stores the period's totals and the running totals since the first
closure of that kind, per currency, in minor units. All kinds share one chain (`sequence`,
`previousHash`, `hash`, `signature`), hashed by `canonicalClosure` with totals as sorted
`[currency, minor]` pairs.

Closures are written lazily: at boot for every company with payments, and before `verify`,
`closures` and an archive. The boot pass also seals payments recorded before the ledger existed,
in `createdAt` order.

## Verification

`verifyPaymentLedger` walks both chains in sequence order and reports, per record:
`unsealed`, `sequence-gap`, `previous-hash-mismatch`, `hash-mismatch`, `signature-mismatch`. A
deleted row shows as a gap plus a previous-hash mismatch on the next one.

## Archives

`buildPaymentLedgerArchive(companyId, year)` closes elapsed periods, then writes a JSON document
(`format: invoicerr-payment-ledger-archive`, `formatVersion: 1`) with the year's payments by
`createdAt`, the closures starting in that year, a verification result and the country's archive
notice. The body and its sha256 are stored in `PaymentLedgerArchive`, append-only like the rest.

## Country data

Nothing in this module checks a country. The legal side lives in the `cashRecording` section of
`countries/data/<cc>.json`, typed and validated by `cash-recording-schema.ts`:

- `obligation`: the conditions (`inalterability`, `security`, `retention`, `archiving`), a summary
  and provenance;
- `exclusions`: who the obligation does not cover, each with provenance;
- `attestation`: the date it applies from and the model, as blocks of text with `{placeholder}`
  fields from `ATTESTATION_PLACEHOLDERS`;
- `archive`: the language and text of the notice put in every archive.

`/payment-ledger/obligation` and `/payment-ledger/attestation` read it through the composed
country catalogue. A country without the section gets `null` and a 404 respectively. The ledger
itself, reversals, closures, verification and archives work the same in every country.

## Endpoints

| Route | Scope | Does |
| --- | --- | --- |
| `GET /payment-ledger/verify` | read | Closes elapsed periods, then checks both chains |
| `GET /payment-ledger/closures?kind=` | read | Lists closures |
| `POST /payment-ledger/payments/:id/reverse` | write | Records a reversal (`reason`, optional `paidAt`) |
| `GET /payment-ledger/obligation` | read | The country's `cashRecording` facts, or `null` |
| `GET /payment-ledger/attestation` | read | Plain-text attestation, `X-Attestation-Missing` header |
| `GET /payment-ledger/archives` | read | Kept archives, without their content |
| `POST /payment-ledger/archives?year=` | write | Generates, keeps and downloads a year's archive |
| `GET /payment-ledger/archives/:id` | read | Downloads a kept archive |

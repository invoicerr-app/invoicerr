---
title: Refund and Cancellation Policy
sidebar_position: 4
version: 2026-10-25
effectiveDate: 2026-10-25
---

:::warning[Draft]
Draft — not yet reviewed by counsel.
:::

This Refund and Cancellation Policy covers the **hosted offering** of Invoicerr. We sell the
subscription to you ourselves and charge it through Stripe (Terms of Service, Sections 1.4 and 7), so
refunds are ours to decide and to pay, under the rules below. It supplements the
[Terms of Service](./terms-of-service.md), in particular Sections 7, 8, 9, 12 and 13; where the two
could be read differently, the Terms of Service govern.

## 1. Scope

This Policy covers only the **hosted offering**, the paid subscription operated at our own domain(s).
It does not apply to the **self-hosted** software: Invoicerr's source code is, and remains, free and
open source under the license published in the `LICENSE` file at the root of the
[repository](https://github.com/invoicerr-app/invoicerr). Running it on your own infrastructure
involves no payment to anyone, so no refund question arises.

## 2. Refunds

**A billing period that has already started is not refunded**, in whole or in part, whether you
cancel during it, reduce your Seat count, or stop using the Service. Cancelling stops the next renewal;
it does not give back the period already under way (Section 4).

The only refunds we pay are the two set out in Section 3, for founder pre-orders. The Service is
offered strictly business-to-business, so no statutory right of withdrawal applies to your subscription
(Terms of Service, Section 1.2).

## 3. Founder Pre-orders

A founder pre-order is a subscription bought in advance, before the hosted Service opens, under its own
pre-order contract. On top of Section 2:

- **Full refund if the Service has not opened.** If the hosted Service is not open on **30 June 2027**,
  the whole amount you paid for your pre-order is refunded.
- **Pro rata refund if the Service stops.** If the hosted Service stops during a period you have
  already paid for, the part of that period during which you no longer receive the Service is refunded
  pro rata.

## 4. Auto-Renewal

**Your subscription renews automatically**, monthly or annually depending on the cycle you chose, at
the per-Seat rate then in effect, until you cancel it (Terms of Service, Sections 6 and 12.1). At each
renewal we charge the means of payment you registered, by card or SEPA direct debit, and issue the
invoice for the new period (Terms of Service, Section 7).

## 5. Cancelling

You can cancel at any time, from Settings > Subscription in the Service or by writing to
**contact@invoicerr.app**. Cancellation takes effect at the **end of the period you have already paid
for**, the end of the current month or year, and you keep full access to paid features until then
(Terms of Service, Section 12.2). Nothing is prorated for the unused part of that period (Section 2).

## 6. Seat Changes Mid-Cycle

The subscription is priced **per Seat** (Terms of Service, Section 6). Your Seat count follows your
Company's actual membership, and a change is reflected in what we invoice for your **next** billing
cycle (Terms of Service, Section 7.3).

## 7. The Free Trial

New Companies receive a **fourteen (14)-day free trial**, with no payment card required: the trial
gives rise to **no payment of any kind**, so no refund question can arise from it (Terms of Service,
Section 3.2). If no paid subscription is activated before the trial ends, your Company enters the
read-only suspension described in Section 8 below.

## 8. What Happens When Your Subscription Ends

When your subscription ends, whether you cancelled it, it was not renewed, or a payment failure was not
resolved, the Terms of Service, Section 13 apply:

- **Read-only for fourteen (14) days.** Your Data stays available to read and export, but every write
  action, including sending or issuing a document, is disabled (Section 13.1).
- **Archive for your Owner.** At the end of those fourteen days, we email your Company's Owner a link
  to download an archive holding, for every document your Company holds, its stored data and, where it
  can be rendered, a copy of it (Section 13.2).
- **Deletion.** Your Company and all its data, archived documents included, are deleted no earlier
  than **thirty (30) days** after that archive is made available if it never had a paid subscription,
  and no earlier than **one hundred eighty (180) days** after it if it did; until then, you can still
  subscribe again (Section 13.3).
- **Your invoices are yours to keep.** We do not keep your invoices for you once your Company is
  deleted: keeping them for any statutory retention period is your responsibility alone
  (Section 13.4).

## 9. Exporting Your Data

You do not have to wait for the end of your subscription. At any time, self-service, you can export
all of Your Data, your accounting ledger as CSV, and each document as PDF or, for an invoice, as EN
16931 XML, from within the Service or through the API (Terms of Service, Sections 8.2 and 10). If you
are moving to another provider, the Terms of Service, Section 9 describe the switching process, its
transitional period, and the fact that we charge no switching fee.

## 10. Failed Payments

If a renewal or a Seat charge fails, update your means of payment from Settings > Subscription. An
amount still unpaid after its due date bears the late payment penalties and the recovery indemnity set
out in the Terms of Service, Section 7.6, and if the failure is not resolved your Company can enter the
**Payment failed** status and then the read-only suspension described in Section 8 above.

## 11. What This Policy Does Not Limit

Nothing in this Policy limits a right you hold under a mandatory rule of law, or our own liability for
a failure to perform our obligations under the Terms of Service.

## 12. Questions

Questions about this Policy, a charge, a refund, or a cancellation can be sent to
**contact@invoicerr.app**.

## 13. Governing Language

This document is drafted and executed in English. Where we provide a translation into another
language for your convenience and understanding, that translation is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated version, **the English version prevails** and is the version that governs the rights and
obligations of the parties. Translations are provided in good faith to help each audience understand
this document; they create no separate or additional rights.

---

### Changelog

- **2026-09-20** — Initial draft. Legal audit finding: no product surface told a customer, before they
  subscribed, that the subscription renews automatically and that no refund or proration is given for
  a cancelled period's unused portion (Terms of Service, Section 12.2) — the checkout itself is run by
  Polar, outside this product's own screens, so the moment of payment carried no such notice either.
  Rather than add a one-line notice, the owner chose a standalone document, linked from the Subscribe
  buttons in Settings > Subscription and from the same curated legal-links row every other document
  appears in. States nothing the Terms of Service, Section 12 does not already establish; Section 6
  (Seat Changes Mid-Cycle) restates Section 7.3's own seat-sync timing rather than adding a new one.
- **2026-10-13**: Refunds now point to Polar. Polar sells the subscription as merchant of record, and
  its Buyer Terms and Conditions govern payment, refunds and chargebacks; its Master Services Terms let
  Polar, as seller, grant a refund and require any refund the supplier agrees to be paid through Polar.
  This Policy no longer states a refund rule of its own: the former Sections 2 ("Who Charges You") and
  5 ("No Refund, No Proration") are replaced by Section 2 ("Refunds"), and the "no proration" rule
  moves into Section 4 ("Cancelling") with a statement that it does not limit a refund Polar grants.
  Section 3 no longer says that no renewal reminder is sent, since Polar's terms say Polar sends them
  where the law requires. The former Section 8 ("No Right of Withdrawal") is removed: whether a right of
  withdrawal applies concerns the purchase, which is Polar's; the Service stays B2B only (Terms of
  Service, Section 1.2). New Sections 7 and 8 say what is ours: what happens when a subscription ends
  (read-only period, archive, deletion) and how to export your data at any time.
- **2026-10-25**: INVOICERR (SASU) now sells the subscription itself and charges it through Stripe, by
  card or SEPA direct debit; Polar is removed. Refunds are ours again. New Section 2: a billing period
  already started is not refunded. New Section 3: a founder pre-order is refunded in full if the hosted
  Service is not open on 30 June 2027, and pro rata if the Service stops during a period already paid
  for. Section 8 now says the end-of-subscription archive is reached through a download link, that
  deletion covers archived documents too, and that the customer alone keeps their invoices. Section 10
  points to the late payment terms of the Terms of Service, Section 7.6. Sections renumbered from 3
  onward.

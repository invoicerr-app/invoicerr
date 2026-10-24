---
title: "Italy e-invoicing in Invoicerr"
description: "Invoicerr ships Italy country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Italy (supported)"
keywords: [Italy e-invoicing, FatturaPA, SdI]
---

# Italy e-invoicing in Invoicerr

:::tip[Invoicerr supports Italy]
Italy is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

Italy's entries name SdI as its invoice transmission platform, and FatturaPA as the format it
carries. An Italian seller's foreign-currency invoice also states both its VAT and its taxable
amount in euros, at the ECB's rate, frozen at issue.

## Validate and the SdI mandate

Invoicerr's **Validate** action normally only assigns an invoice's legal number and locks it, with
no email or transmission of any kind (see the [user guide](../../user-guide/billing/invoices.md)).
Issue #581's first owner decision (2026-10-01) named France only - the only country whose own legal
question had been reviewed at that point - and flagged Italy as an unreviewed CONSEQUENCE: reusing
the existing, country-blind channel-mandate check `send` already runs
(`transports/channel-policy/`) meant a domestic Italian B2B invoice would also transmit through SdI
on Validate, without that being a deliberate legal finding about Italian law.

The owner's revised decision, after reviewing that flag, makes it deliberate: Italy now declares its
own `invoiceValidation` fact in its own `policy` section (`countries/data/it.json`), carrying D.Lgs. 127/2015 art. 1 comma
6's own text as `provenance` - without the accredited channel, "la fattura si intende non emessa"
("the invoice is deemed not issued"), the same constitutive-of-issuance reasoning CGI art. 289 bis I
gives France (see [France](./france.md#validate-and-the-pdp-mandate) for the parallel), stronger
here than DPR 633/1972 art. 21's own general electronic-invoice validity clause. Like France's own
fact, it is validated at both load and seed time, and consulted the same way: Validate performs the
real SdI send only when this fact is declared for the seller country AND the operation is bound by
an active channel mandate right now (`activeChannelMandateForOperation`) - never a hand-written
"country is Italy" branch. See [Adding a
country](../adding-a-country.md#maintainer-note-invoicevalidation-whether-validate-also-transmits)
for the full mechanism.

Because the fact is now explicit, the confirmation dialog knows about it BEFORE anyone confirms:
validating a domestic Italian B2B invoice shows a dedicated alert naming SdI and stating the action
cannot be undone, a separate block from the generic "numbering and locking are final" warning every
other locking action already shows.

The SdI mandate binds a private buyer too. D.Lgs. 127/2015 art. 1 comma 3 covers supplies « tra
soggetti residenti o stabiliti nel territorio dello Stato », not only between taxable persons, and
the same comma provides for e-invoices issued to final consumers. The `sdi` fact therefore carries
no `scope.buyerType`: an Italian invoice to a client of type Individual still goes through SdI, and
Validate still transmits it.

This page is a pointer by design. Everything Invoicerr knows about Italy lives in its own data
files, and two pages already say it without anyone retyping it:

- [Italy in the country compliance matrix](../country-support/it.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Italy](/compliance/it) — the same coverage, written for someone deciding whether
  to use Invoicerr in Italy.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Italy already has.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/it.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). D.Lgs. 231/2002, art. 4, comma 2, lettera a)
caps the payment period at 30 days from the debtor's receipt of the invoice, unless the parties
agree otherwise (`basis: "maximumWhenNotAgreed"`). The application counts the 30 days from the
invoice date, not from receipt of the invoice.

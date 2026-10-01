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
Issue #581's own owner decision (2026-10-01) carves out one exception for this: "For a French
domestic B2B invoice, validating also issues it through the accredited platform, as the law
requires." The decision names France - the only country whose own legal question (CGI art. 289 bis
I) was reviewed for that issue.

Italy carries the same shape of active domestic channel mandate as France's (D.Lgs. 127/2015 art. 1
comma 3, SdI - see [France](./france.md#validate-and-the-pdp-mandate) for the parallel). Because the
implementation reuses the existing, country-blind channel-mandate check `send` already runs
(`transports/channel-policy/`) rather than hand-writing a France-only branch, validating a domestic
Italian B2B invoice also performs the real SdI transmission today, not merely a number-and-lock.
This is a deliberate engineering choice, flagged in the pull request that shipped it - not a
separate legal finding about Italian law, and not something the 2026-10-01 decision explicitly
confirmed. If Italy should instead stay a plain number-and-lock until its own legal question is
reviewed the way France's was, that needs its own owner decision before the behavior changes.

This page is a pointer by design. Everything Invoicerr knows about Italy lives in its own data
files, and two pages already say it without anyone retyping it:

- [Italy in the country compliance matrix](../country-support/it.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Italy](/compliance/it) — the same coverage, written for someone deciding whether
  to use Invoicerr in Italy.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Italy already has.

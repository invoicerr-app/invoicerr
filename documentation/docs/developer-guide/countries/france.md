---
title: "France e-invoicing in Invoicerr"
description: "Invoicerr ships France country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "France (supported)"
keywords: [France e-invoicing, Factur-X, Chorus Pro, PDP]
---

# France e-invoicing in Invoicerr

:::tip[Invoicerr supports France]
France is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

France's entries name Chorus Pro and Factur-X for public buyers, and a PDP channel for sellers
established there. A French seller's foreign-currency invoice also states its VAT in euros, at the
ECB's rate, frozen at issue; and its late-payment mention falls back to the statutory rule's own
wording once the twice-yearly rate table runs out, rather than blocking the send.

## Validate and the PDP mandate

Invoicerr's **Validate** action normally only assigns an invoice's legal number and locks it, with
no email or transmission of any kind (see the [user guide](../../user-guide/billing/invoices.md)).
For a domestic French B2B invoice, that is not enough: CGI art. 289 bis I requires emission,
transmission and reception to go through an accredited platform, so a numbered-and-locked invoice
that never went through one is not yet lawfully issued. The owner's decision (2026-10-01, issue
#581) is that validating one of these invoices performs the real PDP transmission as part of
validating, rather than leaving the invoice in a numbered-but-not-yet-issued limbo someone has to
remember to complete. Concretely, the same preflight and delivery `invoice.descriptor.ts`'s "send"
uses run unchanged - the PDP mandate is never bypassed by choosing Validate instead of Send.

This check reads the same country-blind channel mandate mechanism `send` itself already consults
(`transports/channel-policy/`, scoped to a domestic operation), not a hand-written "country is
France" branch. Today the only other country with an active mandate of the same kind is Italy
(SdI) - see [Italy](./italy.md#validate-and-the-sdi-mandate) for that consequence, which the
2026-10-01 decision names France for but does not discuss by name.

This page is a pointer by design. Everything Invoicerr knows about France lives in its own data
files, and two pages already say it without anyone retyping it:

- [France in the country compliance matrix](../country-support/fr.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — France](/compliance/fr) — the same coverage, written for someone deciding whether
  to use Invoicerr in France.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones France already has.

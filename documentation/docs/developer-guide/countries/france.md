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

## Payment term cap

France's `paymentTerms` section (`countries/data/fr.json`) holds the longest payment term two
businesses may agree on, from Code de commerce art. L. 441-10, I: 60 days net after the invoice's
issue date (`maxNetDays`), or 45 days end of month (`maxEndOfMonthDays`), the latter only when the
contract states it expressly. The [payment terms setting](../../user-guide/settings/payment-terms.md)
reads these two numbers to warn, without blocking, when a company's default term goes beyond them.
Periodic invoices have a shorter cap (45 days net, CGI art. 289, I, 3) that this section does not
model.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/fr.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). Code de commerce art. L. 441-10, I, first
paragraph caps the payment period, when the terms of sale and the parties set nothing else, at 30
days after receipt of the goods or performance of the service (`basis: "maximumWhenNotAgreed"`). The
application counts the 30 days from the invoice date, not from receipt of the goods or performance
of the service.

## Private clients and the SIREN

The SIREN / SIRET scheme (`LEGAL_ID` in the `identifiers` section of `countries/data/fr.json`) is
required of a company and optional for an individual (`requiredFor: ["COMPANY"]`). Code de commerce
art. R.123-237 binds a registered person, and art. R.123-220 lists a natural person in the SIRENE
register only when it trades, employs staff or is otherwise named there: a private person has no
number to give. On the invoice, CGI annexe II art. 242 nonies A, I, 1° asks for the client's number,
which `invoiceRequirements` requires of a domestic business client only. A private client can
therefore be saved, and invoiced, without a SIREN. A sole trader entered as an individual may still
enter one, and it is printed.

## Private clients and the PDP mandate

CGI art. 289 bis, I binds emission through an accredited platform only « lorsque l'émetteur de la
facture et son destinataire sont des assujettis ». A private person is not an assujetti, so an
invoice to a client of type Individual is outside the PDP mandate. The `pdp` fact in the
`channelPolicy` section of `countries/data/fr.json` says so with `scope.buyerType: ["COMPANY"]`,
next to `scope.parties: "domestic"`. Such an invoice is validated and sent like an invoice from a
country with no mandate: no PDP is needed, and Validate only numbers and locks it.

:::info[E-reporting is not transmitted]
A sale to a private person falls under e-reporting (CGI art. 290 A), a separate obligation to
declare the transaction data. Invoicerr records it in the `reporting` section of `fr.json` but does
not transmit it.
:::

A client recorded as a company is treated as an assujetti. An association or a public body outside
the scope of VAT may not be one; the data cannot tell them apart today.

## Validate and the PDP mandate

Invoicerr's **Validate** action normally only assigns an invoice's legal number and locks it, with
no email or transmission of any kind (see the [user guide](../../user-guide/billing/invoices.md)).
For a domestic French invoice to a business client, that is not enough: CGI art. 289 bis I requires emission,
transmission and reception to go through an accredited platform, so a numbered-and-locked invoice
that never went through one is not yet lawfully issued. The owner's decision (2026-10-01, issue
#581, revised after the pull request's own review) is that validating one of these invoices performs
the real PDP transmission as part of validating, rather than leaving the invoice in a
numbered-but-not-yet-issued limbo someone has to remember to complete.

This is now an EXPLICIT per-country fact, not an inferred side-effect of reusing the mandate check:
France's own `policy` section (`countries/data/fr.json`) declares its own `invoiceValidation` field, carrying CGI art. 289 bis
I's own text as `provenance`, validated at both load and seed time like every other fact here (see
[Adding a country](../adding-a-country.md#maintainer-note-invoicevalidation-whether-validate-also-transmits)
for the full mechanism). "Validate" only performs the real send when BOTH this fact is declared for
the invoice's own seller country AND the operation is bound by an active channel mandate right now
(the same country-blind `transports/channel-policy/` check `send` itself already consults, scoped to
a domestic operation) - never a hand-written "country is France" branch. Concretely, when it fires,
the same preflight and delivery `invoice.descriptor.ts`'s "send" uses run unchanged, so the PDP
mandate is never bypassed by choosing Validate instead of Send.

Because the fact is now explicit, the confirmation dialog knows about it BEFORE anyone confirms:
validating a domestic French B2B invoice shows a dedicated alert naming the accredited platform
(PDP) and stating the action cannot be undone, a separate block from the generic "numbering and
locking are final" warning every other locking action already shows. Today the only other country
with the same fact declared is Italy (SdI) - see
[Italy](./italy.md#validate-and-the-sdi-mandate), now reviewed and declared the same deliberate way,
no longer merely an unreviewed consequence of the mandate check.

This page is a pointer by design. Everything Invoicerr knows about France lives in its own data
files, and two pages already say it without anyone retyping it:

- [France in the country compliance matrix](../country-support/fr.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — France](/compliance/fr) — the same coverage, written for someone deciding whether
  to use Invoicerr in France.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones France already has.

---
title: "Poland e-invoicing in Invoicerr"
description: "Invoicerr ships Poland country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Poland (supported)"
keywords: [Poland e-invoicing, FA(3), KSeF]
---

# Poland e-invoicing in Invoicerr

:::tip[Invoicerr supports Poland]
Poland is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

Poland's entries name KSeF as its invoice transmission platform, and FA(3) as the format it carries.
A Polish seller's foreign-currency invoice also states its VAT in PLN, sourced to the NBP's own
Table A rather than the ECB, frozen at issue.

This page is a pointer by design. Everything Invoicerr knows about Poland lives in its own data
files, and two pages already say it without anyone retyping it:

- [Poland in the country compliance matrix](../country-support/pl.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Poland](/compliance/pl) — the same coverage, written for someone deciding whether
  to use Invoicerr in Poland.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Poland already has.

## NIP

Art. 106e ust. 1 of the VAT act asks every invoice for the seller's tax number (pkt 4) and for the
number under which the buyer received the supply (pkt 5). For a Polish business both are its NIP, the
`LEGAL_ID` scheme of the `identifiers` section of `countries/data/pl.json`. The scheme applies to a
company only and is `required: true`: your company's NIP must be filled in to save Settings or finish
onboarding, and a Polish company client's NIP to save the client. A private client has no NIP and is
not offered the field.

:::info[Clients saved before]
A Polish company client saved without its NIP keeps its record. The client form asks for it at the
next edit, and Validate and Send keep refusing an invoice to it until it is filled in.
:::

## Buyer identifier in FA(3)

The FA(3) file identifies the buyer (`Podmiot2`) from the prefix of the buyer's VAT number, not from
its address:

- a Polish number, with or without the `PL` prefix, is sent as `NIP`;
- a number from another EU member state is sent as `KodUE` (the prefix, so `EL` for Greece and `XI`
  for Northern Ireland) and `NrVatUE` (the number without it), the codes accepted being the
  `TKodyKrajowUE` list of the vendored `schemat_FA3.xsd`;
- any other tax identifier is sent as `NrID`, with `KodKraju` set to the buyer's country when it is
  known;
- a buyer with no VAT number is sent as `BrakID`.

## KSeF and private buyers

Art. 106ga ust. 2 pkt 4 of the VAT act lifts the KSeF obligation for an invoice « na rzecz nabywcy
towarów lub usług będącego osobą fizyczną nieprowadzącą działalności gospodarczej », a natural
person not carrying on a business. The `ksef` fact in the `channelPolicy` section of
`countries/data/pl.json` records it with `scope.buyerType: ["COMPANY"]`. The fact is `suggested`,
so the scope has no effect today; it keeps an invoice to a private client outside KSeF if the fact
is ever made `mandated`.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/pl.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). Art. 6 ust. 1 of the Act of 8 March 2013 on
preventing excessive delays in commercial transactions starts statutory interest 30 days after the
creditor's performance when the contract sets no payment date (`basis: "latePaymentThreshold"`). It
sets no payment term. The application counts the 30 days from the invoice date, not from the
creditor's performance.

## Company-law mentions

The `companyLaw` section of `countries/data/pl.json` prints, under the seller's name on invoices,
quotes, credit notes and purchase orders (pisma i zamówienia handlowe), from the Kodeks spółek
handlowych:

| Legal forms | Printed | Source |
| --- | --- | --- |
| sp. z o.o. | "Sąd rejestrowy: …, KRS 0000123456", "Kapitał zakładowy 5000.00 PLN" | art. 206 § 1 |
| S.A., S.K.A. | register line, "Kapitał zakładowy …, kapitał wpłacony …" | art. 374 § 1, art. 127 § 5 |
| P.S.A. | register line, "Kapitał akcyjny …" | art. 300^61 § 1 |
| spółka jawna, komandytowa, partnerska, sole trader, other forms | nothing | none of these articles binds them |

The NIP of point 3) is the `LEGAL_ID` identifier; the seat and address of point 1) are the company
address. Not modelled: the group of companies (point 5) and the unpaid contributions of a sp. z o.o.
formed from the model agreement. Text read in the Kancelaria Sejmu consolidated text (t.j. Dz. U. z
2024 r. poz. 18, with the amendments up to Dz. U. z 2026 r. poz. 644) on 2026-10-25.

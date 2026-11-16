---
title: "Portugal e-invoicing in Invoicerr"
description: "Invoicerr ships Portugal country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Portugal (supported)"
keywords: [Portugal e-invoicing, FE-AP, UBL]
---

# Portugal e-invoicing in Invoicerr

:::tip[Invoicerr supports Portugal]
Portugal is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

Portugal's B2G entry (selling to a government client) names FE-AP as the transmission platform, and
UBL 2.1 as the format it carries; there is no channel mandate for an ordinary B2B seller. `fe-ap` is
not backed by a transport this app talks to yet, so a send to a government client is refused, naming
the channel, rather than silently falling back to email. The AT monthly declaration now carries each
document's real ATCUD and declares credit notes too (as `NC`, referencing the invoice they correct).
Both obligations are triggered by `issued` (DL 198/2012, art. 3: the communication covers documents
issued, by the 5th of the following month), so an invoice validated and never sent is declared too,
and one validated then sent is declared once. See [Declarations](../declarations.md).
See [Compliance - Portugal](/compliance/pt) for the full, sourced picture.

This page is a pointer by design. Everything Invoicerr knows about Portugal lives in its own data
files, and two pages already say it without anyone retyping it:

- [Portugal in the country compliance matrix](../country-support/pt.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Portugal](/compliance/pt) — the same coverage, written for someone deciding whether
  to use Invoicerr in Portugal.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Portugal already has.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/pt.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). Decreto-Lei n.º 62/2013, art. 4.º, n.º 3,
alínea a) makes late-payment interest due 30 days after the debtor receives the invoice when the
contract sets no date (`basis: "latePaymentThreshold"`). It sets no payment term. The application
counts the 30 days from the invoice date, not from receipt of the invoice.

## Private clients and the NIF

The NIF/NIPC scheme (`LEGAL_ID` in the `identifiers` section of `countries/data/pt.json`) is
required of a company and optional for an individual (`requiredFor: ["COMPANY"]`). Código do IVA
art. 36.º, n.º 5, alínea a) asks for the identification number of the acquirer only when it is a
taxable person (« adquirente sujeito passivo do imposto »), and n.º 16 makes a private buyer's NIF
mandatory on the invoice only when that buyer asks for it. A private client can therefore be saved,
and invoiced, without a NIF; one entered is printed on the invoice.

## Company-law mentions

The `companyLaw` section of `countries/data/pt.json` prints, under the seller's name on invoices,
quotes, credit notes and purchase orders, from Código das Sociedades Comerciais artigo 171.º:

| Legal forms | Printed | Number |
| --- | --- | --- |
| every sociedade | "Sociedade por quotas, matriculada na Conservatória do Registo Comercial de Lisboa sob o número de matrícula e de identificação de pessoa coletiva 500000000" | 1 |
| por quotas, unipessoal por quotas, anónima, em comandita por ações | "Capital social 5000.00 EUR" | 2 |
| same | "Capital realizado …", only when filled in ("se for diverso") | 2 |
| Empresário em nome individual, other forms | nothing | artigo 171.º binds sociedades |

The registration number is the NIPC, the `LEGAL_ID` identifier, since artigo 171.º names one
"número de matrícula e de identificação de pessoa colectiva". The sede is the company address. Not
modelled: the capital próprio owed when it is at most half the share capital, and liquidation. Text
read at pgdlisboa.pt (56.ª versão, DL n.º 171/2026) on 2026-10-25.

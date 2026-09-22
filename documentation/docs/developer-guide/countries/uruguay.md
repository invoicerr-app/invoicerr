---
title: "DGI — Uruguay e-invoicing"
description: "Uruguay's DGI CFE e-invoicing system and what adding Uruguay to Invoicerr would involve. Invoicerr does not support Uruguay today."
sidebar_label: "Uruguay"
keywords: [DGI, CFE, Uruguay e-invoicing, Uruguay invoice XML, e-invoicing Uruguay]
---

# DGI — Uruguay e-invoicing

:::warning[Invoicerr does not support Uruguay]
No Uruguay data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Uruguay support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Uruguay's e-invoicing runs through the DGI, the Dirección General de Impuestos. Every document is a
CFE, a Comprobante Fiscal Electrónico, issued as part of a broader DFE (documento fiscal
electrónico) scheme and authorized by the DGI before it can reach the buyer.

## What supporting Uruguay would involve

| | |
|---|---|
| **System** | CFE — Comprobante Fiscal Electrónico (DFE scheme) |
| **Authority** | DGI — Dirección General de Impuestos |
| **Format** | A national XML schema (the DGI CFE schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGI platform for CFE authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by category since 2015, now covering all businesses.
- Digital certificate required for signing.
- Separate CFE subtypes exist for invoices, export invoices, debit/credit notes and consumer
  e-tickets.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Uruguay.

- `country-policy/data/uy.json` — which document actions Uruguay allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/uy.json` — which national identifier a party must carry.
- `tax/tax-systems/data/uy.json` and `vat-rates/data/uy.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/uy.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/uy.json` — the channel and format a Uruguayan public buyer requires.
- `transports/channel-policy/data/uy.json` — whether a channel is legally required of a seller
  established in Uruguay, and from what date.
- `archive/retention/data/uy.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DGI platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Uruguay supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Uruguay, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Uruguay".

---
title: "DGI — Nicaragua e-invoicing"
description: "Nicaragua's DGI e-invoicing system and what adding Nicaragua to Invoicerr would involve. Invoicerr does not support Nicaragua today."
sidebar_label: "Nicaragua"
keywords: [DGI, Nicaragua e-invoicing, RUC invoice, Nicaragua invoice XML, e-invoicing Nicaragua]
---

# DGI — Nicaragua e-invoicing

:::warning[Invoicerr does not support Nicaragua]
No Nicaragua data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Nicaragua support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Nicaragua's e-invoicing runs through the DGI, the Dirección General de Impuestos, which
pre-authorizes every invoice before it can be delivered to the buyer.

## What supporting Nicaragua would involve

| | |
|---|---|
| **System** | Factura Electrónica (DGI) |
| **Authority** | DGI — Dirección General de Impuestos |
| **Format** | A national XML schema (the DGI invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGI platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2019, now covering all businesses.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Nicaragua.

- `country-policy/data/ni.json` — which document actions Nicaragua allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ni.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ni.json` and `vat-rates/data/ni.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ni.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ni.json` — the channel and format a Nicaraguan public buyer requires.
- `transports/channel-policy/data/ni.json` — whether a channel is legally required of a seller
  established in Nicaragua, and from what date.
- `archive/retention/data/ni.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DGI platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Nicaragua supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Nicaragua, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Nicaragua".

---
title: "DGI — Panama e-invoicing"
description: "Panama's DGI e-invoicing system and what adding Panama to Invoicerr would involve. Invoicerr does not support Panama today."
sidebar_label: "Panama"
keywords: [DGI, Panama e-invoicing, RUC invoice, Panama invoice XML, e-invoicing Panama]
---

# DGI — Panama e-invoicing

:::warning[Invoicerr does not support Panama]
No Panama data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Panama support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Panama's e-invoicing runs through the DGI, the Dirección General de Ingresos, under the FE/CF scheme
(factura electrónica / comprobante fiscal), which pre-authorizes every document before it can be
delivered to the buyer.

## What supporting Panama would involve

| | |
|---|---|
| **System** | Factura Electrónica / Comprobante Fiscal (FE/CF) |
| **Authority** | DGI — Dirección General de Ingresos |
| **Format** | A national XML schema (the DGI FE/CF schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGI platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2018, now covering all businesses.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Panama.

- `country-policy/data/pa.json` — which document actions Panama allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/pa.json` — which national identifier a party must carry.
- `tax/tax-systems/data/pa.json` and `vat-rates/data/pa.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/pa.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/pa.json` — the channel and format a Panamanian public buyer requires.
- `transports/channel-policy/data/pa.json` — whether a channel is legally required of a seller
  established in Panama, and from what date.
- `archive/retention/data/pa.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DGI platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Panama supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Panama, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Panama".
